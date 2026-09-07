import { and, eq, inArray, isNull } from 'drizzle-orm';
import { sdk } from '@sovereignfs/sdk';
import type {
  DeletionContext,
  DeletionResult,
  ExportContext,
  ImportContext,
  PluginExportSection,
} from '@sovereignfs/sdk';
import {
  expensePayers,
  expenseSplits,
  expenses,
  groupMembers,
  groups,
  settlements,
  userSettings,
} from '../_db/schema';
import { computeNetBalances } from './balances';
import type { Db } from './context';
import { newId } from './ids';

/**
 * Registers Tally's export/import/delete participation (RFC 0007/RFC 0033,
 * SPEC.md §7/§8) — "Sovereign-native backup/restore," not a Splitwise-format
 * importer (`CONCEPT.md` §6 non-goal). Must be called from a request-scoped
 * Tally route — this repo calls it from `app/(home)/layout.tsx`, same
 * precedent as Docs' `registerPortabilityHandlers` (registrations are
 * in-process and reset on restart, so re-registering on every request is
 * the established pattern, not a one-time setup step).
 */
const PLUGIN_ID = 'fs.sovereign.tally';
const EXPORT_SCHEMA_VERSION = 1;

export async function registerPortabilityHandlers(): Promise<void> {
  await sdk.portability.provideExport(exportTallyData);
  await sdk.portability.provideImport(importTallyData);
  await sdk.portability.provideDelete(deleteTallyData);
}

// ---- Export shape ----
// Scoped to every group the exporting user is a *current active member* of
// (owner or member) — unlike Docs' "owned content only" model, a shared
// ledger's real value to the exporting user is the complete group, not just
// their own rows (a partial expense list can't even reconstruct correct
// balances). Real users' current display names are captured now, at export
// time — a raw account id has no guaranteed counterpart on another Sovereign
// instance (same reasoning Docs' own `documentMembers` export already
// established), so a name is the only portable identity worth keeping.

interface ExportGroup {
  id: string;
  name: string;
  description: string | null;
  defaultCurrency: string;
  startDate: number | null;
  endDate: number | null;
  archivedAt: number | null;
  simplifyDebts?: boolean;
  createdAt: number;
}

interface ExportMember {
  id: string;
  groupId: string;
  kind: 'user' | 'guest';
  /** Captured display name — a guest's own name, or a real member's
   *  directory name/email at export time. */
  label: string;
  /** True only for the exporting user's own membership row — see the
   *  import section below for why this is the one member restored as a
   *  real account rather than a guest. */
  isExportingUser: boolean;
  role: 'owner' | 'member';
  joinedAt: number;
}

interface ExportExpense {
  id: string;
  groupId: string;
  description: string;
  amountCents: number;
  currency: string;
  category: string | null;
  occurredOn: number;
  notes: string | null;
  splitMethod: string;
  /** Relative path of this expense's receipt inside the section's `blobs`
   *  (`receipts/<expenseId>/<filename>`), when one was attached and the
   *  export included files. */
  receiptBlobPath?: string | null;
  receiptContentType?: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ExportExpensePayer {
  expenseId: string;
  memberId: string;
  amountCents: number;
}

interface ExportExpenseSplit {
  expenseId: string;
  memberId: string;
  shareAmountCents: number;
  shareUnits: number | null;
}

interface ExportSettlement {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
  currency: string;
  note: string | null;
  settledOn: number;
  createdAt: number;
}

interface TallyExportData {
  primaryCurrency: string | null;
  groups: ExportGroup[];
  members: ExportMember[];
  expenses: ExportExpense[];
  payers: ExportExpensePayer[];
  splits: ExportExpenseSplit[];
  settlements: ExportSettlement[];
}

async function exportTallyData(ctx: ExportContext): Promise<PluginExportSection> {
  const db = (await sdk.db.getClient()) as Db;
  const { userId, tenantId } = ctx;

  const myMemberships = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.userId, userId),
        eq(groupMembers.tenantId, tenantId),
        eq(groupMembers.kind, 'user'),
        isNull(groupMembers.leftAt),
      ),
    );
  const groupIds = Array.from(new Set(myMemberships.map((m) => m.groupId)));

  const empty: TallyExportData = {
    primaryCurrency: null,
    groups: [],
    members: [],
    expenses: [],
    payers: [],
    splits: [],
    settlements: [],
  };
  if (groupIds.length === 0) {
    return { pluginId: PLUGIN_ID, schemaVersion: EXPORT_SCHEMA_VERSION, data: empty };
  }

  const [groupRows, memberRows, expenseRows, settlementRows, settingsRows] = await Promise.all([
    db.select().from(groups).where(inArray(groups.id, groupIds)),
    db
      .select()
      .from(groupMembers)
      .where(and(inArray(groupMembers.groupId, groupIds), isNull(groupMembers.leftAt))),
    db
      .select()
      .from(expenses)
      .where(and(inArray(expenses.groupId, groupIds), isNull(expenses.deletedAt))),
    db
      .select()
      .from(settlements)
      .where(and(inArray(settlements.groupId, groupIds), isNull(settlements.deletedAt))),
    db
      .select({ primaryCurrency: userSettings.primaryCurrency })
      .from(userSettings)
      .where(eq(userSettings.userId, userId)),
  ]);

  const expenseIds = expenseRows.map((e) => e.id);
  const [payerRows, splitRows] = await Promise.all([
    expenseIds.length > 0
      ? db.select().from(expensePayers).where(inArray(expensePayers.expenseId, expenseIds))
      : Promise.resolve([]),
    expenseIds.length > 0
      ? db.select().from(expenseSplits).where(inArray(expenseSplits.expenseId, expenseIds))
      : Promise.resolve([]),
  ]);

  const realUserIds = Array.from(
    new Set(memberRows.filter((m) => m.kind === 'user' && m.userId).map((m) => m.userId as string)),
  );
  const resolvedUsers =
    realUserIds.length > 0 ? await sdk.directory.resolveUsers({ ids: realUserIds }) : [];
  const nameByUserId = new Map(resolvedUsers.map((u) => [u.id, u.name ?? u.email]));

  // Receipt images travel as section blobs (RFC 0007's `blobs`), keyed by
  // their storage key, when the user asked for files — a restore without
  // them still has every ledger row, just no attachment link.
  const blobs: Record<string, Uint8Array> = {};
  const blobWarnings: string[] = [];
  const receiptByExpenseId = new Map<string, { path: string; contentType: string }>();
  if (ctx.options.includeFiles) {
    for (const e of expenseRows) {
      if (!e.receiptStorageKey) continue;
      try {
        const object = await sdk.storage.get(e.receiptStorageKey);
        if (!object) continue;
        const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
        blobs[e.receiptStorageKey] = bytes;
        receiptByExpenseId.set(e.id, {
          path: e.receiptStorageKey,
          contentType: object.contentType,
        });
      } catch {
        blobWarnings.push(`The receipt for "${e.description}" could not be read and was skipped.`);
      }
    }
  }

  const data: TallyExportData = {
    primaryCurrency: settingsRows[0]?.primaryCurrency ?? null,
    groups: groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      defaultCurrency: g.defaultCurrency,
      startDate: g.startDate,
      endDate: g.endDate,
      archivedAt: g.archivedAt,
      simplifyDebts: g.simplifyDebts,
      createdAt: g.createdAt,
    })),
    members: memberRows.map((m) => ({
      id: m.id,
      groupId: m.groupId,
      kind: m.kind === 'guest' ? 'guest' : 'user',
      label:
        m.kind === 'user'
          ? (nameByUserId.get(m.userId ?? '') ?? 'Unknown member')
          : (m.guestName ?? 'Guest'),
      isExportingUser: m.kind === 'user' && m.userId === userId,
      role: m.role === 'owner' ? 'owner' : 'member',
      joinedAt: m.joinedAt,
    })),
    expenses: expenseRows.map((e) => ({
      id: e.id,
      groupId: e.groupId,
      description: e.description,
      amountCents: e.amountCents,
      currency: e.currency,
      category: e.category,
      occurredOn: e.occurredOn,
      notes: e.notes,
      splitMethod: e.splitMethod,
      receiptBlobPath: receiptByExpenseId.get(e.id)?.path ?? null,
      receiptContentType: receiptByExpenseId.get(e.id)?.contentType ?? null,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    })),
    payers: payerRows.map((p) => ({
      expenseId: p.expenseId,
      memberId: p.memberId,
      amountCents: p.amountCents,
    })),
    splits: splitRows.map((s) => ({
      expenseId: s.expenseId,
      memberId: s.memberId,
      shareAmountCents: s.shareAmountCents,
      shareUnits: s.shareUnits,
    })),
    settlements: settlementRows.map((s) => ({
      id: s.id,
      groupId: s.groupId,
      fromMemberId: s.fromMemberId,
      toMemberId: s.toMemberId,
      amountCents: s.amountCents,
      currency: s.currency,
      note: s.note,
      settledOn: s.settledOn,
      createdAt: s.createdAt,
    })),
  };

  const hasOtherMembers = data.members.some((m) => !m.isExportingUser);
  const warnings = [
    ...(hasOtherMembers
      ? [
          'Other group members are restored as guests on import, using their name at export time — their original accounts are not re-linked. Re-add them as real members from Group settings after importing, if needed.',
        ]
      : []),
    ...blobWarnings,
  ];

  return {
    pluginId: PLUGIN_ID,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    data,
    blobs: Object.keys(blobs).length > 0 ? blobs : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ---- Import ----
// Every imported group is created fresh, owned solely by the importing
// user — mirrors Docs' "every restored document is local, owned by the
// importing user" precedent. The exporting user's own membership becomes
// the new group's real (and only) 'user'-kind member; every *other*
// original member (real user or guest alike) is restored as a guest, since
// a real user's account id has no guaranteed counterpart on the
// destination instance — this preserves the full ledger's math (every
// split/payer still resolves to a valid member) without silently
// re-granting a stranger's account access to data it never actually
// belonged to on this instance.

function isTallyExportData(value: unknown): value is TallyExportData {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<TallyExportData>;
  return (
    Array.isArray(c.groups) &&
    Array.isArray(c.members) &&
    Array.isArray(c.expenses) &&
    Array.isArray(c.payers) &&
    Array.isArray(c.splits) &&
    Array.isArray(c.settlements)
  );
}

async function importTallyData(section: PluginExportSection, ctx: ImportContext): Promise<void> {
  if (section.schemaVersion !== EXPORT_SCHEMA_VERSION || !isTallyExportData(section.data)) {
    throw new Error('Tally import section has an unrecognized shape.');
  }
  const data = section.data;
  const db = (await sdk.db.getClient()) as Db;
  const ts = Math.floor(Date.now() / 1000);

  // Receipts first: a storage put outside the ledger transaction below is
  // harmless if the transaction then fails (an orphaned object, not a
  // broken ledger), whereas the reverse would leave rows pointing at
  // nothing.
  const receiptKeyByExpenseId = new Map<string, string>();
  for (const e of data.expenses) {
    const bytes = e.receiptBlobPath ? section.blobs?.[e.receiptBlobPath] : undefined;
    if (!bytes || !e.receiptContentType) continue;
    const newExpenseId = ctx.remapId(e.id);
    const filename = e.receiptBlobPath?.split('/').pop() ?? 'receipt';
    const key = `receipts/${newExpenseId}/${filename}`;
    try {
      await sdk.storage.put({ key, body: bytes, contentType: e.receiptContentType });
      receiptKeyByExpenseId.set(e.id, key);
    } catch {
      // The expense is still restored, just without its attachment.
    }
  }

  await db.transaction(async (tx) => {
    await importRows(tx as unknown as Db, data, ctx, ts, receiptKeyByExpenseId);
  });
}

async function importRows(
  db: Db,
  data: TallyExportData,
  ctx: ImportContext,
  ts: number,
  receiptKeyByExpenseId: Map<string, string>,
): Promise<void> {
  if (data.primaryCurrency) {
    await db
      .insert(userSettings)
      .values({
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        primaryCurrency: data.primaryCurrency,
        updatedAt: ts,
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { primaryCurrency: data.primaryCurrency, updatedAt: ts },
      });
  }

  for (const g of data.groups) {
    await db.insert(groups).values({
      id: ctx.remapId(g.id),
      tenantId: ctx.tenantId,
      name: g.name,
      description: g.description,
      defaultCurrency: g.defaultCurrency,
      startDate: g.startDate,
      endDate: g.endDate,
      simplifyDebts: g.simplifyDebts ?? false,
      createdByUserId: ctx.userId,
      createdAt: g.createdAt,
      updatedAt: ts,
      archivedAt: g.archivedAt,
    });
  }

  for (const m of data.members) {
    const base = {
      id: ctx.remapId(m.id),
      groupId: ctx.remapId(m.groupId),
      tenantId: ctx.tenantId,
      joinedAt: m.joinedAt,
    };
    if (m.isExportingUser) {
      await db.insert(groupMembers).values({
        ...base,
        kind: 'user',
        userId: ctx.userId,
        // Sole real member on this instance — always the owner, regardless
        // of the exporting user's original role (mirrors Docs' identical
        // "every restored document is owned by the importing user" call).
        role: 'owner',
      });
    } else {
      await db.insert(groupMembers).values({
        ...base,
        kind: 'guest',
        guestName: m.label,
        guestOwnerUserId: ctx.userId,
        role: 'member',
      });
    }
  }

  for (const e of data.expenses) {
    await db.insert(expenses).values({
      id: ctx.remapId(e.id),
      groupId: ctx.remapId(e.groupId),
      tenantId: ctx.tenantId,
      description: e.description,
      amountCents: e.amountCents,
      currency: e.currency,
      category: e.category,
      occurredOn: e.occurredOn,
      notes: e.notes,
      splitMethod: e.splitMethod,
      receiptStorageKey: receiptKeyByExpenseId.get(e.id) ?? null,
      createdByUserId: ctx.userId,
      createdAt: e.createdAt,
      updatedAt: ts,
    });
  }

  if (data.payers.length > 0) {
    await db.insert(expensePayers).values(
      data.payers.map((p) => ({
        id: newId(),
        expenseId: ctx.remapId(p.expenseId),
        memberId: ctx.remapId(p.memberId),
        amountCents: p.amountCents,
      })),
    );
  }

  if (data.splits.length > 0) {
    await db.insert(expenseSplits).values(
      data.splits.map((s) => ({
        id: newId(),
        expenseId: ctx.remapId(s.expenseId),
        memberId: ctx.remapId(s.memberId),
        shareAmountCents: s.shareAmountCents,
        shareUnits: s.shareUnits,
      })),
    );
  }

  for (const s of data.settlements) {
    await db.insert(settlements).values({
      id: ctx.remapId(s.id),
      groupId: ctx.remapId(s.groupId),
      tenantId: ctx.tenantId,
      fromMemberId: ctx.remapId(s.fromMemberId),
      toMemberId: ctx.remapId(s.toMemberId),
      amountCents: s.amountCents,
      currency: s.currency,
      note: s.note,
      settledOn: s.settledOn,
      createdByUserId: ctx.userId,
      createdAt: s.createdAt,
    });
  }
}

// ---- Delete ----
// SPEC.md §7: a shared ledger's rows are joint records other members'
// balances depend on — deleting them on this user's account deletion would
// silently corrupt every other member's math. Every expense/payer/split/
// settlement row is left in place. What *does* happen, so the remaining
// members aren't stranded:
//
// - Each of the user's active memberships is ended (`leftAt`) when their
//   balance in that group is zero — exactly what "Leave group" does — so
//   they stop appearing as a live "Unknown member" in balances and member
//   counts. A membership with an outstanding balance stays active, still
//   attributed, so the debt remains visible to the others.
// - Where the user was a group's only owner, the longest-standing remaining
//   real member is promoted to owner. Without this the group would have no
//   one able to add members, close it, or change settings — a permanent
//   lockout with no recovery path.
// - The user's own personal settings row (not joint data) is deleted.
//
// A real hard block for a non-zero balance was decided but is not buildable
// as a Tally-only change (`provideDelete` runs after deletion is already
// committed, with no veto mechanism) — flagged upstream in SPEC.md §7.
async function deleteTallyData(ctx: DeletionContext): Promise<DeletionResult> {
  const db = ctx.db as Db;
  const errors: string[] = [];
  const ts = Math.floor(Date.now() / 1000);

  const memberships = await db
    .select({ id: groupMembers.id, groupId: groupMembers.groupId, role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.userId, ctx.userId),
        eq(groupMembers.tenantId, ctx.tenantId),
        eq(groupMembers.kind, 'user'),
        isNull(groupMembers.leftAt),
      ),
    );

  for (const membership of memberships) {
    try {
      const otherMembers = await db
        .select({
          id: groupMembers.id,
          kind: groupMembers.kind,
          role: groupMembers.role,
          joinedAt: groupMembers.joinedAt,
        })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, membership.groupId),
            eq(groupMembers.tenantId, ctx.tenantId),
            isNull(groupMembers.leftAt),
          ),
        );
      const otherUsers = otherMembers.filter((m) => m.id !== membership.id && m.kind === 'user');

      if (membership.role === 'owner' && !otherUsers.some((m) => m.role === 'owner')) {
        const successor = [...otherUsers].sort((a, b) => a.joinedAt - b.joinedAt)[0];
        if (successor) {
          await db
            .update(groupMembers)
            .set({ role: 'owner' })
            .where(eq(groupMembers.id, successor.id));
        }
      }

      if (!(await memberHasBalance(db, membership.groupId, membership.id))) {
        await db.update(groupMembers).set({ leftAt: ts }).where(eq(groupMembers.id, membership.id));
      }
    } catch (error) {
      errors.push(
        `Group ${membership.groupId}: ${error instanceof Error ? error.message : 'cleanup failed'}`,
      );
    }
  }

  const existing = await db
    .select({ userId: userSettings.userId })
    .from(userSettings)
    .where(and(eq(userSettings.userId, ctx.userId), eq(userSettings.tenantId, ctx.tenantId)));
  if (existing.length > 0) {
    await db
      .delete(userSettings)
      .where(and(eq(userSettings.userId, ctx.userId), eq(userSettings.tenantId, ctx.tenantId)));
  }
  return { deleted: existing.length, errors: errors.length > 0 ? errors : undefined };
}

/** Same check as `membership.ts`'s `hasNonZeroBalance`, reimplemented on the
 *  deletion context's own client rather than importing the request-scoped
 *  helper (whose `Db` is the same shape but arrives via `getContext()`). */
async function memberHasBalance(db: Db, groupId: string, memberId: string): Promise<boolean> {
  const [groupExpenses, memberPayers, memberSplits, groupSettlements] = await Promise.all([
    db
      .select({ id: expenses.id, currency: expenses.currency, deletedAt: expenses.deletedAt })
      .from(expenses)
      .where(eq(expenses.groupId, groupId)),
    db
      .select({
        expenseId: expensePayers.expenseId,
        memberId: expensePayers.memberId,
        amountCents: expensePayers.amountCents,
      })
      .from(expensePayers)
      .where(eq(expensePayers.memberId, memberId)),
    db
      .select({
        expenseId: expenseSplits.expenseId,
        memberId: expenseSplits.memberId,
        shareAmountCents: expenseSplits.shareAmountCents,
      })
      .from(expenseSplits)
      .where(eq(expenseSplits.memberId, memberId)),
    db
      .select({
        fromMemberId: settlements.fromMemberId,
        toMemberId: settlements.toMemberId,
        amountCents: settlements.amountCents,
        currency: settlements.currency,
        deletedAt: settlements.deletedAt,
      })
      .from(settlements)
      .where(eq(settlements.groupId, groupId)),
  ]);
  const balances = computeNetBalances({
    expenses: groupExpenses,
    payers: memberPayers,
    splits: memberSplits,
    settlements: groupSettlements.filter(
      (s) => s.fromMemberId === memberId || s.toMemberId === memberId,
    ),
  });
  return balances.some((b) => b.memberId === memberId && b.amountCents !== 0);
}
