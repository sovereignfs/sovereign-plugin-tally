/**
 * Pure group-role logic — no DB access. Mirrors the shape of the Docs
 * plugin's own `folder-rules.ts`/`document-rules.ts` (`FolderMemberRole`,
 * `canEditFolderRole`), the established pattern for this kind of
 * role-vocabulary file in this app family (SPEC.md §5).
 */

export type GroupMemberRole = 'owner' | 'member';

export function isGroupMemberRole(value: string): value is GroupMemberRole {
  return value === 'owner' || value === 'member';
}

/**
 * 'owner': rename/close/delete the group, add/remove members, change
 * roles. 'member': view balances and add expenses/settlements, but
 * cannot manage the group itself (SPEC.md §5's `group-manage` capability).
 */
export function canManageGroup(role: GroupMemberRole | null | undefined): boolean {
  return role === 'owner';
}
