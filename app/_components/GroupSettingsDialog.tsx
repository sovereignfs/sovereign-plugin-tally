'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  FormField,
  Input,
  Select,
  Spinner,
  StatusBadge,
  Textarea,
  Tooltip,
} from '@sovereignfs/ui';
import type { DirectoryUser } from '@sovereignfs/sdk';
import { CURRENCY_OPTIONS } from '../_lib/currencies';
import type { ActionResult, GroupSettingsView } from '../_lib/group-settings';
import formStyles from './DialogForm.module.css';
import styles from './GroupSettingsDialog.module.css';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

interface GroupSettingsDialogProps {
  open: boolean;
  onClose: () => void;
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

function epochToDateInput(value: number | null): string {
  if (value === null) return '';
  return new Date(value * 1000).toISOString().slice(0, 10);
}

/**
 * Owner-only "Group settings" (UI-FLOW.md §8) — a Details form (name/
 * description/currency/dates) plus a Members section (list, add real user
 * via debounced `sdk.directory.searchUsers`, add guest with an optional
 * email invite, resend a bounced invite, change role, remove). Same
 * Dialog + `useActionState` + debounced-search shape as Sheets'
 * `WorkbookShareDialog` — this plugin's own established reference for a
 * member-management dialog (UI-FLOW.md §8's own validated precedent).
 *
 * `refreshNonce` remounts both forms whenever settings are re-fetched after
 * a successful mutation — the same uncontrolled-`defaultValue`-staleness fix
 * `PrimaryCurrencyForm`'s `key={primaryCurrency}` already established
 * elsewhere in this plugin, generalized here since this dialog has several
 * `defaultValue`-driven fields refreshed together, not just one.
 */
export function GroupSettingsDialog({
  open,
  onClose,
  getSettingsAction,
  updateDetailsAction,
  searchUsersAction,
  addMemberFormAction,
  resendInviteAction,
  removeMemberAction,
  updateRoleAction,
}: GroupSettingsDialogProps) {
  const [settings, setSettings] = useState<GroupSettingsView | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);

  const [addMode, setAddMode] = useState<'user' | 'guest'>('user');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<DirectoryUser | null>(null);

  const [detailsState, detailsFormAction, detailsPending] = useActionState<
    ActionResult | null,
    FormData
  >(updateDetailsAction, null);
  const [addState, addFormAction, addPending] = useActionState<ActionResult | null, FormData>(
    addMemberFormAction,
    null,
  );

  function refresh() {
    getSettingsAction().then((data) => {
      setSettings(data);
      setRefreshNonce((n) => n + 1);
    });
  }

  useEffect(() => {
    if (!open) {
      setSettings(null);
      setMemberActionError(null);
      setAddMode('user');
      setQuery('');
      setResults([]);
      setSelectedUser(null);
      return;
    }
    refresh();
    // refreshes on open only — refresh() wraps stable bound actions, keying
    // on `open` alone (matching WorkbookShareDialog's own precedent) avoids
    // a fetch loop.
  }, [open]);

  useEffect(() => {
    if (addState?.ok) {
      setQuery('');
      setResults([]);
      setSelectedUser(null);
      refresh();
    }
  }, [addState]);

  useEffect(() => {
    if (detailsState?.ok) refresh();
  }, [detailsState]);

  useEffect(() => {
    if (selectedUser || addMode !== 'user' || query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchUsersAction(query.trim())
        .then((users) => {
          if (!cancelled) setResults(users);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selectedUser, addMode, searchUsersAction]);

  const ownerCount = settings?.members.filter((m) => m.role === 'owner').length ?? 0;

  async function handleResend(memberId: string) {
    setMemberActionError(null);
    setPendingMemberId(memberId);
    const result = await resendInviteAction(memberId);
    setPendingMemberId(null);
    if (result.ok) refresh();
    else setMemberActionError(result.error);
  }

  async function handleRemove(memberId: string) {
    setMemberActionError(null);
    setPendingMemberId(memberId);
    const result = await removeMemberAction(memberId);
    setPendingMemberId(null);
    if (result.ok) refresh();
    else setMemberActionError(result.error);
  }

  async function handleRoleChange(memberId: string, role: string) {
    setMemberActionError(null);
    setPendingMemberId(memberId);
    const result = await updateRoleAction(memberId, role);
    setPendingMemberId(null);
    if (result.ok) refresh();
    else setMemberActionError(result.error);
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Group settings">
      {settings === null ? (
        <div className={styles.loading}>
          <Spinner />
        </div>
      ) : (
        <div className={styles.body}>
          <section className={styles.section}>
            <h3 className={styles.sectionHeading}>Details</h3>
            <form key={refreshNonce} action={detailsFormAction} className={formStyles.form}>
              {detailsState && !detailsState.ok && (
                <p className={formStyles.feedbackError} role="status" aria-live="polite">
                  {detailsState.error}
                </p>
              )}
              {detailsState?.ok && (
                <p role="status" aria-live="polite">
                  {detailsState.message}
                </p>
              )}
              <FormField label="Name" required>
                {(field) => <Input {...field} name="name" required defaultValue={settings.name} />}
              </FormField>
              <FormField label="Description" hint="Optional">
                {(field) => (
                  <Textarea
                    {...field}
                    name="description"
                    rows={2}
                    defaultValue={settings.description ?? ''}
                  />
                )}
              </FormField>
              <FormField label="Default currency" required>
                {(field) => (
                  <Select {...field} name="defaultCurrency" defaultValue={settings.defaultCurrency}>
                    {CURRENCY_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <div className={styles.dateRow}>
                <FormField label="Start date" hint="Optional">
                  {(field) => (
                    <Input
                      {...field}
                      name="startDate"
                      type="date"
                      defaultValue={epochToDateInput(settings.startDate)}
                    />
                  )}
                </FormField>
                <FormField label="End date" hint="Optional">
                  {(field) => (
                    <Input
                      {...field}
                      name="endDate"
                      type="date"
                      defaultValue={epochToDateInput(settings.endDate)}
                    />
                  )}
                </FormField>
              </div>
              <div className={formStyles.actions}>
                <Button type="submit" disabled={detailsPending}>
                  {detailsPending ? 'Saving…' : 'Save details'}
                </Button>
              </div>
            </form>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionHeading}>Members</h3>

            {memberActionError && (
              <p className={formStyles.feedbackError} role="alert">
                {memberActionError}
              </p>
            )}

            <ul className={styles.members}>
              {settings.members.map((member) => {
                const isLastOwner = member.role === 'owner' && ownerCount <= 1;
                const isBusy = pendingMemberId === member.memberId;
                return (
                  <li key={member.memberId} className={styles.member}>
                    <div>
                      <p className={styles.memberName}>{member.label}</p>
                      {member.email ? <p className={styles.memberEmail}>{member.email}</p> : null}
                      {member.kind === 'guest' ? (
                        <p className={styles.memberMeta}>
                          Guest
                          {member.guestInviteStatus ? ` · Invite ${member.guestInviteStatus}` : ''}
                        </p>
                      ) : null}
                    </div>
                    <div className={styles.memberActions}>
                      {member.kind === 'guest' && member.guestInviteStatus === 'bounced' ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => handleResend(member.memberId)}
                        >
                          Resend
                        </Button>
                      ) : null}

                      {member.kind === 'user' ? (
                        <Select
                          aria-label={`Role for ${member.label}`}
                          value={member.role}
                          disabled={isBusy || isLastOwner}
                          onChange={(e) => handleRoleChange(member.memberId, e.currentTarget.value)}
                        >
                          <option value="owner">Owner</option>
                          <option value="member">Member</option>
                        </Select>
                      ) : (
                        <StatusBadge status="unmodified">Guest</StatusBadge>
                      )}

                      {isLastOwner ? (
                        <Tooltip content="The last owner can't be removed.">
                          <span>
                            <Button type="button" variant="ghost" size="sm" disabled>
                              Remove
                            </Button>
                          </span>
                        </Tooltip>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => handleRemove(member.memberId)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className={styles.addSection}>
              <div className={styles.addModeToggle}>
                <Button
                  type="button"
                  variant={addMode === 'user' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setAddMode('user')}
                >
                  Add existing user
                </Button>
                <Button
                  type="button"
                  variant={addMode === 'guest' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setAddMode('guest')}
                >
                  Add guest
                </Button>
              </div>

              <form key={refreshNonce} action={addFormAction} className={formStyles.form}>
                <input type="hidden" name="kind" value={addMode} />
                {addState && !addState.ok && (
                  <p className={formStyles.feedbackError} role="status" aria-live="polite">
                    {addState.error}
                  </p>
                )}
                {addState?.ok && addState.message ? (
                  <p className={styles.addSuccess} role="status" aria-live="polite">
                    {addState.message}
                  </p>
                ) : null}

                {addMode === 'user' ? (
                  <>
                    <input type="hidden" name="userId" value={selectedUser?.id ?? ''} />
                    <FormField
                      label="Person"
                      hint={selectedUser ? undefined : 'Search by name or email'}
                    >
                      {(field) => (
                        <div className={styles.picker}>
                          <Input
                            {...field}
                            value={selectedUser ? (selectedUser.name ?? selectedUser.email) : query}
                            onChange={(event) => {
                              setSelectedUser(null);
                              setQuery(event.currentTarget.value);
                            }}
                            placeholder="Search by name or email"
                            autoComplete="off"
                          />
                          {results.length > 0 && !selectedUser ? (
                            <ul className={styles.results}>
                              {results.map((user) => (
                                <li key={user.id}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedUser(user);
                                      setResults([]);
                                    }}
                                  >
                                    {user.name ?? user.email}
                                    {user.name ? ` (${user.email})` : ''}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      )}
                    </FormField>
                    <div className={formStyles.actions}>
                      <Button type="submit" disabled={!selectedUser || addPending}>
                        {addPending ? 'Adding…' : 'Add member'}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <FormField label="Name" required>
                      {(field) => (
                        <Input {...field} name="guestName" required placeholder="Sam Rivera" />
                      )}
                    </FormField>
                    <FormField label="Email" hint="Optional — sends an invite notice">
                      {(field) => (
                        <Input
                          {...field}
                          name="guestEmail"
                          type="email"
                          placeholder="sam@example.com"
                        />
                      )}
                    </FormField>
                    <div className={formStyles.actions}>
                      <Button type="submit" disabled={addPending}>
                        {addPending ? 'Adding…' : 'Add guest'}
                      </Button>
                    </div>
                  </>
                )}
              </form>
            </div>
          </section>
        </div>
      )}
    </Dialog>
  );
}
