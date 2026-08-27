'use client';

import { useState } from 'react';
import { Button, Icon } from '@sovereignfs/ui';
import type { DirectoryUser } from '@sovereignfs/sdk';
import type { ActionResult, GroupSettingsView } from '../_lib/group-settings';
import { GroupSettingsDialog } from './GroupSettingsDialog';

interface GroupSettingsButtonProps {
  getSettingsAction: () => Promise<GroupSettingsView | null>;
  updateDetailsAction: (
    prevState: ActionResult | null,
    formData: FormData,
  ) => Promise<ActionResult>;
  searchUsersAction: (query: string) => Promise<DirectoryUser[]>;
  addMemberFormAction: (
    prevState: ActionResult | null,
    formData: FormData,
  ) => Promise<ActionResult>;
  resendInviteAction: (memberId: string) => Promise<ActionResult>;
  removeMemberAction: (memberId: string) => Promise<ActionResult>;
  updateRoleAction: (memberId: string, role: string) => Promise<ActionResult>;
}

/** Group detail column's gear-icon entry point into `GroupSettingsDialog` (UI-FLOW.md §4/§8), owner-only. */
export function GroupSettingsButton(props: GroupSettingsButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Group settings"
        onClick={() => setOpen(true)}
      >
        <Icon name="settings" size="sm" aria-hidden />
      </Button>
      <GroupSettingsDialog open={open} onClose={() => setOpen(false)} {...props} />
    </>
  );
}
