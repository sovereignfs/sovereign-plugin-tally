'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Checkbox,
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
import { toDateInputValue } from '../_lib/activity';
import type { ActionResult, GroupSettingsView } from '../_lib/group-settings';
import { CurrencyPicker } from './CurrencyPicker';
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

/**
 * Owner-only "Group settings" (UI-FLOW.md §8) — a Details form (name/
 * description/currency/dates/simplify-debts) plus a Members section (list,
 * add real user via debounced `sdk.directory.searchUsers`, add guest with
 * an optional email invite, resend a bounced invite, change role, remove).
 *
 * Any mutation that ends the current user's own right to manage the group
 * (demoting or removing themselves) closes the dialog and refreshes the
 * page instead of re-fetching settings they can no longer read — the
 * re-fetch would otherwise reject and leave the dialog frozen on stale data.
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
  const router = useRouter();
  const [settings, setSettings] = useState<GroupSettingsView | null>(null);
  /** Whether settings have loaded at least once this open — decides whether
   *  a failed re-fetch means "lost access" (leave) or "never loaded" (error). */
  const loadedRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  /** Optimistic role per member while its update is in flight, so the
   *  controlled `<select>` doesn't snap back to the old value mid-request. */
  const [optimisticRoles, setOptimisticRoles] = useState<Map<string, string>>(new Map());

  const [currency, setCurrency] = useState('');
  const [simplify, setSimplify] = useState(false);
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

  const leaveDialog = useCallback(() => {
    onClose();
    router.refresh();
  }, [onClose, router]);

  const refresh = useCallback(() => {
    getSettingsAction()
      .then((data) => {
        if (!data) {
          leaveDialog();
          return;
        }
        loadedRef.current = true;
        setSettings(data);
        setCurrency(data.defaultCurrency);
        setSimplify(data.simplifyDebts);
        setOptimisticRoles(new Map());
        setRefreshNonce((n) => n + 1);
      })
      .catch((error: unknown) => {
        // Lost access mid-session (demoted/removed) — nothing left to manage.
        if (loadedRef.current) leaveDialog();
        else setLoadError(error instanceof Error ? error.message : 'Settings could not be loaded.');
      });
  }, [getSettingsAction, leaveDialog]);

  useEffect(() => {
    if (!open) {
      loadedRef.current = false;
      setSettings(null);
      setLoadError(null);
      setMemberActionError(null);
      setAddMode('user');
      setQuery('');
      setResults([]);
      setSelectedUser(null);
      return;
    }
    refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (addState?.ok) {
      setQuery('');
      setResults([]);
      setSelectedUser(null);
      refresh();
    }
  }, [addState, refresh]);

  useEffect(() => {
    if (detailsState?.ok) refresh();
  }, [detailsState, refresh]);

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

  async function runMemberAction(
    memberId: string,
    action: () => Promise<ActionResult>,
    endsMyAccess: boolean,
  ) {
    setMemberActionError(null);
    setPendingMemberId(memberId);
    const result = await action();
    setPendingMemberId(null);
    if (!result.ok) {
      setOptimisticRoles(new Map());
      setMemberActionError(result.error);
      return;
    }
    if (endsMyAccess) leaveDialog();
    else refresh();
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Group settings">
      {loadError ? (
        <p className={formStyles.feedbackError} role="alert">
          {loadError}
        </p>
      ) : settings === null ? (
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
                <p className={formStyles.feedbackSuccess} role="status" aria-live="polite">
                  {detailsState.message}
                </p>
              )}
              <FormField label="Name" required>
                {(field) => (
                  <Input
                    {...field}
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={settings.name}
                  />
                )}
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
                {() => (
                  <CurrencyPicker
                    name="defaultCurrency"
                    value={currency}
                    onChange={setCurrency}
                    aria-label="Default currency"
                  />
                )}
              </FormField>
              <div className={styles.dateRow}>
                <FormField label="Start date" hint="Optional">
                  {(field) => (
                    <Input
                      {...field}
                      name="startDate"
                      type="date"
                      defaultValue={toDateInputValue(settings.startDate)}
                    />
                  )}
                </FormField>
                <FormField label="End date" hint="Optional">
                  {(field) => (
                    <Input
                      {...field}
                      name="endDate"
                      type="date"
                      defaultValue={toDateInputValue(settings.endDate)}
                    />
                  )}
                </FormField>
              </div>
              <input type="hidden" name="simplifyDebts" value={simplify ? 'on' : ''} />
              <FormField
                label="Balances"
                hint={
                  simplify
                    ? 'Suggested payments are reduced to the fewest transfers. Someone may be asked to pay a person they never split a bill with.'
                    : 'Each person owes exactly what they shared with each other person. More payments, but every one is between people who actually split a bill.'
                }
              >
                {() => (
                  <Checkbox checked={simplify} onChange={setSimplify} label="Simplify debts" />
                )}
              </FormField>
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
                const shownRole = optimisticRoles.get(member.memberId) ?? member.role;
                return (
                  <li key={member.memberId} className={styles.member}>
                    <div>
                      <p className={styles.memberName}>
                        {member.label}
                        {member.isMe ? <span className={styles.memberYou}> (you)</span> : null}
                      </p>
                      {member.email ? <p className={styles.memberEmail}>{member.email}</p> : null}
                      {member.kind === 'guest' ? (
                        <p className={styles.memberMeta}>
                          Guest
                          {member.managedByLabel ? ` · added by ${member.managedByLabel}` : ''}
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
                          onClick={() =>
                            runMemberAction(
                              member.memberId,
                              () => resendInviteAction(member.memberId),
                              false,
                            )
                          }
                        >
                          Resend
                        </Button>
                      ) : null}

                      {member.kind === 'user' ? (
                        <Select
                          aria-label={`Role for ${member.label}`}
                          value={shownRole}
                          disabled={isBusy || isLastOwner}
                          onChange={(e) => {
                            const role = e.currentTarget.value;
                            setOptimisticRoles((prev) => new Map(prev).set(member.memberId, role));
                            void runMemberAction(
                              member.memberId,
                              () => updateRoleAction(member.memberId, role),
                              member.isMe && role === 'member',
                            );
                          }}
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
                          onClick={() =>
                            runMemberAction(
                              member.memberId,
                              () => removeMemberAction(member.memberId),
                              member.isMe,
                            )
                          }
                        >
                          {member.isMe ? 'Leave' : 'Remove'}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className={styles.addSection}>
              {settings.archivedAt !== null ? (
                <p className={styles.memberMeta}>This group is closed. Reopen it to add members.</p>
              ) : (
                <>
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
                      <p className={formStyles.feedbackSuccess} role="status" aria-live="polite">
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
                                value={
                                  selectedUser ? (selectedUser.name ?? selectedUser.email) : query
                                }
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
                            <Input
                              {...field}
                              name="guestName"
                              required
                              maxLength={100}
                              placeholder="Sam Rivera"
                            />
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
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </Dialog>
  );
}
