'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { sdk } from '@sovereignfs/sdk';
import type { DirectoryUser } from '@sovereignfs/sdk';
import { groupMembers, groups } from '../_db/schema';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import { isGroupMemberRole } from './group-rules';
import { newId } from './ids';
import { hasNonZeroBalance, hasOtherActiveOwner, requireGroupManage } from './membership';

export type { ActionResult };

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface GroupSettingsMemberView {
  memberId: string;
  kind: 'user' | 'guest';
  label: string;
  /** A real member's directory email, or a guest's optional invite email. */
  email: string | null;
  role: 'owner' | 'member';
  /** Only meaningful for guests with an email on file (SPEC.md §3/§8). */
  guestInviteStatus: 'sent' | 'bounced' | null;
}

export interface GroupSettingsView {
  id: string;
  name: string;
  description: string | null;
  defaultCurrency: string;
  /** Epoch seconds, date-only semantics — null means unset (SPEC.md §3). */
  startDate: number | null;
  endDate: number | null;
  members: GroupSettingsMemberView[];
}

/**
 * Full group-settings detail for the owner-only settings dialog (UI-FLOW.md
 * §8) — a separate, richer read than `groups.ts`'s `getGroupDetail`, since
 * the settings screen needs fields (dates, guest email/invite status) that
 * screen has no use for.
 */
export async function getGroupSettings(groupId: string): Promise<GroupSettingsView | null> {
  const { db, userId, tenantId } = await getContext();
  await requireGroupManage(db, tenantId, userId, groupId);

  const [group] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId)));
  if (!group) return null;

  const members = await db
    .select()
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.tenantId, tenantId),
        isNull(groupMembers.leftAt),
      ),
    );

  const realUserIds = members
    .filter((m) => m.kind === 'user' && m.userId)
    .map((m) => m.userId)
    .filter((id): id is string => id !== null);
  const resolvedUsers =
    realUserIds.length > 0 ? await sdk.directory.resolveUsers({ ids: realUserIds }) : [];
  const userById = new Map(resolvedUsers.map((u) => [u.id, u]));

  const memberViews: GroupSettingsMemberView[] = members.map((m) => {
    if (m.kind === 'user') {
      const user = userById.get(m.userId ?? '');
      return {
        memberId: m.id,
        kind: 'user' as const,
        label: user?.name ?? user?.email ?? 'Unknown member',
        email: user?.email ?? null,
        role: m.role === 'owner' ? ('owner' as const) : ('member' as const),
        guestInviteStatus: null,
      };
    }
    return {
      memberId: m.id,
      kind: 'guest' as const,
      label: m.guestName ?? 'Guest',
      email: m.guestEmail,
      role: 'member' as const,
      guestInviteStatus:
        m.guestInviteStatus === 'sent' || m.guestInviteStatus === 'bounced'
          ? m.guestInviteStatus
          : null,
    };
  });
  // Owner(s) first, then alphabetical — a stable, predictable order for a
  // management screen rather than raw insertion order.
  memberViews.sort((a, b) => {
    if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  return {
    id: group.id,
    name: group.name,
    description: group.description,
    defaultCurrency: group.defaultCurrency,
    startDate: group.startDate,
    endDate: group.endDate,
    members: memberViews,
  };
}

function parseOptionalDate(value: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  const parsed = Math.floor(new Date(trimmed).getTime() / 1000);
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: parsed };
}

/** Name, description, default currency, start/end dates — one form (SPEC.md §6/§9). */
export async function updateGroupDetailsAction(
  groupId: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  await requireGroupManage(db, tenantId, userId, groupId);

  const name = String(formData.get('name') ?? '').trim();
  const defaultCurrency = String(formData.get('defaultCurrency') ?? '')
    .trim()
    .toUpperCase();
  const description = String(formData.get('description') ?? '').trim();
  const startDate = parseOptionalDate(String(formData.get('startDate') ?? ''));
  const endDate = parseOptionalDate(String(formData.get('endDate') ?? ''));

  if (!name) return { ok: false, error: 'Enter a group name.' };
  if (!CURRENCY_CODE_RE.test(defaultCurrency)) return { ok: false, error: 'Choose a currency.' };
  if (!startDate.ok) return { ok: false, error: 'Enter a valid start date.' };
  if (!endDate.ok) return { ok: false, error: 'Enter a valid end date.' };
  if (startDate.value !== null && endDate.value !== null && endDate.value < startDate.value) {
    return { ok: false, error: 'End date must be on or after the start date.' };
  }

  await db
    .update(groups)
    .set({
      name,
      description: description || null,
      defaultCurrency,
      startDate: startDate.value,
      endDate: endDate.value,
      updatedAt: now(),
    })
    .where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId)));

  revalidatePath('/tally/groups');
  return { ok: true, message: 'Group settings saved.' };
}

/** Directory typeahead for the settings dialog's "add member" picker. */
export async function searchGroupDirectoryUsers(
  groupId: string,
  query: string,
): Promise<DirectoryUser[]> {
  const { db, userId, tenantId } = await getContext();
  await requireGroupManage(db, tenantId, userId, groupId);

  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const [results, existingMembers] = await Promise.all([
    sdk.directory.searchUsers({ query: trimmed, limit: 8 }),
    db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.tenantId, tenantId),
          eq(groupMembers.kind, 'user'),
          isNull(groupMembers.leftAt),
        ),
      ),
  ]);
  const existingUserIds = new Set(
    existingMembers.map((m) => m.userId).filter((id): id is string => id !== null),
  );
  return results.filter((u) => !existingUserIds.has(u.id));
}

/**
 * Sends the guest email-invite notice (SPEC.md §8) — a plain informational
 * notice with no login link, per spec. Returns the resulting
 * `guest_invite_status`: `'sent'` on a successful `sdk.mailer.send()` call
 * (which itself no-ops silently when SMTP is unconfigured — indistinguishable
 * from a real delivery at this call site, per `docs/plugin-development.md`),
 * `'bounced'` if the call throws (a real send failure or rate limit).
 */
async function sendGuestInviteEmail(input: {
  guestEmail: string;
  guestName: string;
  groupName: string;
  inviterLabel: string;
}): Promise<'sent' | 'bounced'> {
  const subject = `You were added to "${input.groupName}" on Tally`;
  const text = `${input.inviterLabel} added you ("${input.guestName}") to "${input.groupName}" on Tally, a shared expense tracker. This is an informational notice only — there's nothing to sign in to or claim.`;
  try {
    await sdk.mailer.send({ to: input.guestEmail, subject, text }, await headers());
    return 'sent';
  } catch {
    return 'bounced';
  }
}

/** Real user via `sdk.directory.searchUsers`; guest via a name field, with an optional email that triggers an invite send (SPEC.md §6/§8). */
export async function addMemberAction(
  groupId: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  await requireGroupManage(db, tenantId, userId, groupId);

  const [group] = await db
    .select({ name: groups.name })
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId)));
  if (!group) return { ok: false, error: 'Group not found.' };

  const kind = String(formData.get('kind') ?? '').trim();

  if (kind === 'user') {
    const memberUserId = String(formData.get('userId') ?? '').trim();
    if (!memberUserId) return { ok: false, error: 'Choose a person to add.' };

    const [resolvedUser] = await sdk.directory.resolveUsers({ ids: [memberUserId] });
    if (!resolvedUser) return { ok: false, error: 'That user could not be found.' };

    const existing = await db
      .select({ id: groupMembers.id })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.tenantId, tenantId),
          eq(groupMembers.userId, memberUserId),
          eq(groupMembers.kind, 'user'),
          isNull(groupMembers.leftAt),
        ),
      );
    if (existing.length > 0) return { ok: false, error: 'Already a member of this group.' };

    await db.insert(groupMembers).values({
      id: newId(),
      groupId,
      tenantId,
      kind: 'user',
      userId: memberUserId,
      role: 'member',
      joinedAt: now(),
    });

    // Added-to-a-group notice (SPEC.md §6's event table) — best-effort, a
    // failure here must never undo an add that already succeeded.
    try {
      await sdk.notifications.send(
        {
          recipientUserId: memberUserId,
          title: 'Added to a Tally group',
          body: `You were added to "${group.name}".`,
          url: `/tally/groups?g=${groupId}`,
        },
        await headers(),
      );
    } catch {
      // See comment above.
    }

    revalidatePath('/tally/groups');
    return { ok: true, message: `Added ${resolvedUser.name ?? resolvedUser.email}.` };
  }

  if (kind === 'guest') {
    const guestName = String(formData.get('guestName') ?? '').trim();
    const guestEmail = String(formData.get('guestEmail') ?? '').trim();
    if (!guestName) return { ok: false, error: 'Enter a name for the guest.' };
    if (guestEmail && !EMAIL_RE.test(guestEmail)) {
      return { ok: false, error: 'Enter a valid email address, or leave it blank.' };
    }

    let guestInviteStatus: 'sent' | 'bounced' | null = null;
    if (guestEmail) {
      const [inviter] = await sdk.directory.resolveUsers({ ids: [userId] });
      guestInviteStatus = await sendGuestInviteEmail({
        guestEmail,
        guestName,
        groupName: group.name,
        inviterLabel: inviter?.name ?? inviter?.email ?? 'A group member',
      });
    }

    await db.insert(groupMembers).values({
      id: newId(),
      groupId,
      tenantId,
      kind: 'guest',
      guestName,
      guestEmail: guestEmail || null,
      guestInviteStatus,
      guestOwnerUserId: userId,
      role: 'member',
      joinedAt: now(),
    });

    revalidatePath('/tally/groups');
    if (!guestEmail) return { ok: true, message: `Added ${guestName}.` };
    return guestInviteStatus === 'sent'
      ? { ok: true, message: `Added ${guestName} and sent an invite email.` }
      : { ok: true, message: `Added ${guestName}, but the invite email failed to send.` };
  }

  return { ok: false, error: 'Invalid member type.' };
}

/** Re-sends the invite email for a `guest_invite_status` that never delivered (SPEC.md §6). */
export async function resendGuestInviteAction(
  groupId: string,
  memberId: string,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  await requireGroupManage(db, tenantId, userId, groupId);

  const [group] = await db
    .select({ name: groups.name })
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId)));
  if (!group) return { ok: false, error: 'Group not found.' };

  const [member] = await db
    .select()
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.id, memberId),
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.tenantId, tenantId),
        eq(groupMembers.kind, 'guest'),
        isNull(groupMembers.leftAt),
      ),
    );
  if (!member || !member.guestEmail)
    return { ok: false, error: 'This guest has no invite email to resend.' };

  const [inviter] = await sdk.directory.resolveUsers({ ids: [userId] });
  const status = await sendGuestInviteEmail({
    guestEmail: member.guestEmail,
    guestName: member.guestName ?? 'Guest',
    groupName: group.name,
    inviterLabel: inviter?.name ?? inviter?.email ?? 'A group member',
  });

  await db
    .update(groupMembers)
    .set({ guestInviteStatus: status })
    .where(eq(groupMembers.id, memberId));

  revalidatePath('/tally/groups');
  return status === 'sent'
    ? { ok: true, message: 'Invite email resent.' }
    : { ok: false, error: 'The invite email failed to send again.' };
}

/** Last-owner + non-zero-balance guards (SPEC.md §5/§6). */
export async function removeMemberAction(groupId: string, memberId: string): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  await requireGroupManage(db, tenantId, userId, groupId);

  const [member] = await db
    .select()
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.id, memberId),
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.tenantId, tenantId),
        isNull(groupMembers.leftAt),
      ),
    );
  // Already gone — idempotent, matches Sheets' removeWorkbookMember precedent.
  if (!member) return { ok: true };

  if (member.role === 'owner') {
    const otherOwnerExists = await hasOtherActiveOwner(db, tenantId, groupId, memberId);
    if (!otherOwnerExists) return { ok: false, error: 'The last owner cannot be removed.' };
  }

  if (await hasNonZeroBalance(db, groupId, memberId)) {
    return {
      ok: false,
      error: 'This member has an outstanding balance and cannot be removed yet.',
    };
  }

  await db.update(groupMembers).set({ leftAt: now() }).where(eq(groupMembers.id, memberId));

  revalidatePath('/tally/groups');
  return { ok: true, message: 'Member removed.' };
}

/** Last-owner check (SPEC.md §5/§6). */
export async function updateMemberRoleAction(
  groupId: string,
  memberId: string,
  role: string,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  await requireGroupManage(db, tenantId, userId, groupId);

  if (!isGroupMemberRole(role)) return { ok: false, error: 'Invalid role.' };

  const [member] = await db
    .select()
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.id, memberId),
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.tenantId, tenantId),
        isNull(groupMembers.leftAt),
      ),
    );
  if (!member) return { ok: false, error: 'Member not found.' };
  if (member.kind !== 'user') return { ok: false, error: "A guest's role can't be changed." };
  if (member.role === role) return { ok: true };

  if (member.role === 'owner' && role === 'member') {
    const otherOwnerExists = await hasOtherActiveOwner(db, tenantId, groupId, memberId);
    if (!otherOwnerExists) return { ok: false, error: 'The last owner cannot be demoted.' };
  }

  await db.update(groupMembers).set({ role }).where(eq(groupMembers.id, memberId));

  revalidatePath('/tally/groups');
  return { ok: true, message: 'Role updated.' };
}
