/**
 * Dev seed script — populates Tally's isolated dev database with realistic
 * sample data for testing: 2 groups, real Sovereign users *and* guest
 * members, expenses across all 4 split methods, two currencies, varied
 * payers (including a guest paying), and settlements (including one from
 * a guest).
 *
 * Requires `pnpm sv seed` to have already been run once from the monorepo
 * root — this script looks up the well-known dev accounts by email, never
 * hardcodes ids (those are randomly generated per database):
 *   owner@sovereign.local   (the target user — sign in as this one)
 *   admin@sovereign.local
 *   auditor@sovereign.local
 *   user@sovereign.local
 *
 * Only 4 real accounts, not 5 — there's no 5th well-known dev account, and
 * depending on whichever extra real user happens to exist in a given
 * database would make this script non-portable across environments. The
 * remaining "people" are guest members instead (`kind: 'guest'`,
 * SPEC.md §3) — which also genuinely exercises the guest path (email
 * invite status, a guest as an expense's payer, a guest settling up) that
 * 5 real users alone would never touch at all.
 *
 * Also requires `pnpm dev` to have been run at least once already, so this
 * plugin's isolated sqld namespace exists and its migrations have run —
 * this script only inserts rows, it never creates tables.
 *
 * Run from this plugin's own directory (or `pnpm --filter
 * sovereign-plugin-tally exec tsx scripts/seed.ts` from the monorepo
 * root), with the dev sqld instance already running (`pnpm dev` or `tsx
 * scripts/ensure-sqld.ts` starts it):
 *
 *   pnpm seed
 *   pnpm seed -- --reset   # wipe this script's own data first, then reseed
 *
 * Idempotent by default: no-ops (prints what already exists) if the seed
 * data is already present, rather than duplicating it on a second run.
 *
 * Connects directly to the dev sqld instance via `@libsql/client` rather
 * than importing `@sovereignfs/db` — same precedent as the Kanban
 * plugin's own `scripts/seed.ts` for standalone dev tooling outside a
 * Next.js request context (`sdk.db.getClient()` needs the
 * `x-sovereign-plugin-id` request header, which doesn't exist here).
 * SQLite (sqld) dev only; this plugin has no Postgres dev seed path today.
 */
import { createClient, type Client } from '@libsql/client';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { distributeByWeights, distributeEvenly } from '../app/_lib/rounding';
import * as schema from '../app/_db/schema';

const SQLD_URL = process.env.SOVEREIGN_SQLD_URL ?? 'http://localhost:28080';
const TALLY_NAMESPACE = 'plugin_fs_sovereign_tally';
const AUTH_NAMESPACE = 'sovereign_auth';
const TENANT_ID = 'default';
const RESET = process.argv.includes('--reset');

function namespacedClient(namespace: string): Client {
  return createClient({
    url: SQLD_URL,
    fetch: (input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set('x-namespace', namespace);
      return fetch(input as string, { ...init, headers });
    },
  });
}

interface DevUser {
  id: string;
  name: string;
  email: string;
}

async function lookupDevUsers(): Promise<{
  owner: DevUser;
  admin: DevUser;
  member: DevUser;
  auditor: DevUser;
}> {
  const auth = namespacedClient(AUTH_NAMESPACE);
  const emails = [
    'owner@sovereign.local',
    'admin@sovereign.local',
    'user@sovereign.local',
    'auditor@sovereign.local',
  ];
  const res = await auth.execute({
    sql: `SELECT id, name, email FROM "user" WHERE email IN (${emails.map(() => '?').join(',')})`,
    args: emails,
  });
  auth.close();

  const byEmail = new Map(
    res.rows.map((r) => [
      r.email as string,
      { id: r.id as string, name: r.name as string, email: r.email as string },
    ]),
  );
  const missing = emails.filter((e) => !byEmail.has(e));
  if (missing.length > 0) {
    throw new Error(
      `Missing dev account(s): ${missing.join(', ')}. Run "pnpm sv seed" from the monorepo root first, then re-run this script.`,
    );
  }
  function requireUser(email: string): DevUser {
    const user = byEmail.get(email);
    if (!user) throw new Error(`Missing dev account: ${email}`);
    return user;
  }
  return {
    owner: requireUser('owner@sovereign.local'),
    admin: requireUser('admin@sovereign.local'),
    member: requireUser('user@sovereign.local'),
    auditor: requireUser('auditor@sovereign.local'),
  };
}

// ---------------------------------------------------------------------------
// Fixed ids for the two groups and their members/expenses (prefixed
// `seed-`) — makes this script idempotent and `--reset` trivial: the
// idempotency check queries for `GROUP_ROOMIES` by this fixed id, and
// `--reset` deletes both groups' rows in dependency order (this schema has
// no `onDelete: 'cascade'` — SPEC.md's soft-delete philosophy for real
// user data — so the cleanup here does it by hand, children first).
const GROUP_ROOMIES = 'seed-group-roomies';
const GROUP_TRIP = 'seed-group-bali-trip';

const DAY = 24 * 60 * 60;
const NOW = Math.floor(Date.now() / 1000);
const daysAgo = (n: number): number => NOW - n * DAY;

async function main(): Promise<void> {
  const users = await lookupDevUsers();
  const client = namespacedClient(TALLY_NAMESPACE);
  const db = drizzle(client, { schema });

  if (RESET) {
    console.log('--reset: deleting prior seed data...');
    const groupIds = [GROUP_ROOMIES, GROUP_TRIP];
    const expenseRows = await db
      .select({ id: schema.expenses.id })
      .from(schema.expenses)
      .where(inArray(schema.expenses.groupId, groupIds));
    const expenseIds = expenseRows.map((e) => e.id);
    if (expenseIds.length > 0) {
      await db
        .delete(schema.expensePayers)
        .where(inArray(schema.expensePayers.expenseId, expenseIds));
      await db
        .delete(schema.expenseSplits)
        .where(inArray(schema.expenseSplits.expenseId, expenseIds));
    }
    await db.delete(schema.expenses).where(inArray(schema.expenses.groupId, groupIds));
    await db.delete(schema.settlements).where(inArray(schema.settlements.groupId, groupIds));
    // References group_members (fromMemberId/toMemberId) — must go before
    // that delete, same reason expense_payers/expense_splits go before
    // expenses above (Inbox's `[Remind]` action, added 2026-08-27).
    await db.delete(schema.reminders).where(inArray(schema.reminders.groupId, groupIds));
    await db.delete(schema.groupMembers).where(inArray(schema.groupMembers.groupId, groupIds));
    await db.delete(schema.groups).where(inArray(schema.groups.id, groupIds));
  }

  const existing = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.id, GROUP_ROOMIES));
  if (existing.length > 0) {
    console.log('Seed data already present (group "Roomies" exists) — nothing to do.');
    console.log('Run again with --reset to wipe and recreate it.');
    client.close();
    return;
  }

  let idCounter = 0;
  const seedId = (label: string): string => `seed-${label}-${(idCounter++).toString(36)}`;

  // -------------------------------------------------------------------
  // Group 1 — "Roomies": all 4 real dev accounts, USD, every split
  // method, varied payers, one partial settlement.
  // -------------------------------------------------------------------
  await db.insert(schema.groups).values({
    id: GROUP_ROOMIES,
    tenantId: TENANT_ID,
    name: 'Roomies',
    description: 'Shared apartment expenses.',
    defaultCurrency: 'USD',
    createdByUserId: users.owner.id,
    createdAt: daysAgo(30),
    updatedAt: daysAgo(30),
  });

  const rOwner = 'seed-member-r-owner';
  const rAdmin = 'seed-member-r-admin';
  const rUser = 'seed-member-r-user';
  const rAuditor = 'seed-member-r-auditor';
  await db.insert(schema.groupMembers).values([
    {
      id: rOwner,
      groupId: GROUP_ROOMIES,
      tenantId: TENANT_ID,
      kind: 'user',
      userId: users.owner.id,
      role: 'owner',
      joinedAt: daysAgo(30),
    },
    {
      id: rAdmin,
      groupId: GROUP_ROOMIES,
      tenantId: TENANT_ID,
      kind: 'user',
      userId: users.admin.id,
      role: 'member',
      joinedAt: daysAgo(30),
    },
    {
      id: rUser,
      groupId: GROUP_ROOMIES,
      tenantId: TENANT_ID,
      kind: 'user',
      userId: users.member.id,
      role: 'member',
      joinedAt: daysAgo(30),
    },
    {
      id: rAuditor,
      groupId: GROUP_ROOMIES,
      tenantId: TENANT_ID,
      kind: 'user',
      userId: users.auditor.id,
      role: 'member',
      joinedAt: daysAgo(30),
    },
  ]);
  const rAll = [rOwner, rAdmin, rUser, rAuditor];

  async function addExpense(input: {
    id: string;
    groupId: string;
    description: string;
    amountCents: number;
    currency: string;
    category: string;
    occurredOn: number;
    splitMethod: schema.ExpenseRow['splitMethod'];
    payers: Array<{ memberId: string; amountCents: number }>;
    /** For 'equal': just the participant list. For 'amount': exact per-member amounts (must sum to amountCents). For 'percentage'/'shares': weights (percentage as 0-100, shares as raw count). */
    split:
      | { method: 'equal'; participants: string[] }
      | { method: 'amount'; amounts: Record<string, number> }
      | { method: 'percentage'; weights: Record<string, number> }
      | { method: 'shares'; weights: Record<string, number> };
    createdByUserId: string;
  }): Promise<void> {
    await db.insert(schema.expenses).values({
      id: input.id,
      groupId: input.groupId,
      tenantId: TENANT_ID,
      description: input.description,
      amountCents: input.amountCents,
      currency: input.currency,
      category: input.category,
      occurredOn: input.occurredOn,
      splitMethod: input.splitMethod,
      createdByUserId: input.createdByUserId,
      createdAt: input.occurredOn,
      updatedAt: input.occurredOn,
    });
    await db.insert(schema.expensePayers).values(
      input.payers.map((p) => ({
        id: seedId('payer'),
        expenseId: input.id,
        memberId: p.memberId,
        amountCents: p.amountCents,
      })),
    );

    const split = input.split;
    let resolved: Map<string, number>;
    let shareUnitsByMember = new Map<string, number>();
    if (split.method === 'amount') {
      const amounts = split.amounts;
      resolved = new Map(Object.entries(amounts));
      const sum = [...resolved.values()].reduce((a, b) => a + b, 0);
      if (sum !== input.amountCents)
        throw new Error(
          `${input.description}: amount split sums to ${sum}, expected ${input.amountCents}`,
        );
    } else if (split.method === 'equal') {
      resolved = distributeEvenly(input.amountCents, split.participants);
    } else if (split.method === 'percentage') {
      const rawWeights = new Map(Object.entries(split.weights));
      const order = [...rawWeights.keys()];
      const basisPoints = new Map(
        order.map((m) => [m, Math.round((rawWeights.get(m) ?? 0) * 100)]),
      );
      resolved = distributeByWeights(input.amountCents, basisPoints, order);
      shareUnitsByMember = basisPoints;
    } else {
      const rawWeights = new Map(Object.entries(split.weights));
      const order = [...rawWeights.keys()];
      resolved = distributeByWeights(input.amountCents, rawWeights, order);
      shareUnitsByMember = new Map(
        order.map((m) => [m, Math.round((rawWeights.get(m) ?? 0) * 100)]),
      );
    }

    await db.insert(schema.expenseSplits).values(
      [...resolved.entries()].map(([memberId, shareAmountCents]) => ({
        id: seedId('split'),
        expenseId: input.id,
        memberId,
        shareAmountCents,
        shareUnits: shareUnitsByMember.get(memberId) ?? null,
      })),
    );
  }

  await addExpense({
    id: 'seed-expense-rent',
    groupId: GROUP_ROOMIES,
    description: 'Rent — March',
    amountCents: 240_000,
    currency: 'USD',
    category: 'rent',
    occurredOn: daysAgo(25),
    splitMethod: 'equal',
    payers: [{ memberId: rOwner, amountCents: 240_000 }],
    split: { method: 'equal', participants: rAll },
    createdByUserId: users.owner.id,
  });
  await addExpense({
    id: 'seed-expense-groceries-1',
    groupId: GROUP_ROOMIES,
    description: 'Groceries — Costco run',
    amountCents: 18_642,
    currency: 'USD',
    category: 'groceries',
    occurredOn: daysAgo(20),
    splitMethod: 'equal',
    payers: [{ memberId: rAdmin, amountCents: 18_642 }],
    split: { method: 'equal', participants: rAll },
    createdByUserId: users.admin.id,
  });
  await addExpense({
    id: 'seed-expense-internet',
    groupId: GROUP_ROOMIES,
    description: 'Internet bill',
    amountCents: 7_999,
    currency: 'USD',
    category: 'utilities',
    occurredOn: daysAgo(18),
    splitMethod: 'equal',
    payers: [{ memberId: rUser, amountCents: 7_999 }],
    split: { method: 'equal', participants: rAll },
    createdByUserId: users.member.id,
  });
  await addExpense({
    id: 'seed-expense-electricity',
    groupId: GROUP_ROOMIES,
    description: 'Electricity bill',
    amountCents: 14_230,
    currency: 'USD',
    category: 'utilities',
    occurredOn: daysAgo(15),
    splitMethod: 'amount',
    payers: [{ memberId: rAuditor, amountCents: 14_230 }],
    split: {
      method: 'amount',
      amounts: { [rOwner]: 6_000, [rAdmin]: 3_000, [rUser]: 3_000, [rAuditor]: 2_230 },
    },
    createdByUserId: users.auditor.id,
  });
  await addExpense({
    id: 'seed-expense-streaming',
    groupId: GROUP_ROOMIES,
    description: 'Netflix + Spotify bundle',
    amountCents: 3_497,
    currency: 'USD',
    category: 'entertainment',
    occurredOn: daysAgo(12),
    splitMethod: 'percentage',
    payers: [{ memberId: rOwner, amountCents: 3_497 }],
    split: {
      method: 'percentage',
      weights: { [rOwner]: 40, [rAdmin]: 20, [rUser]: 20, [rAuditor]: 20 },
    },
    createdByUserId: users.owner.id,
  });
  await addExpense({
    id: 'seed-expense-costco-membership',
    groupId: GROUP_ROOMIES,
    description: 'Costco membership renewal',
    amountCents: 6_000,
    currency: 'USD',
    category: 'general',
    occurredOn: daysAgo(10),
    splitMethod: 'shares',
    payers: [{ memberId: rAdmin, amountCents: 6_000 }],
    split: { method: 'shares', weights: { [rOwner]: 2, [rAdmin]: 2, [rUser]: 1, [rAuditor]: 1 } },
    createdByUserId: users.admin.id,
  });
  await addExpense({
    id: 'seed-expense-pizza',
    groupId: GROUP_ROOMIES,
    description: 'Pizza night',
    amountCents: 5_200,
    currency: 'USD',
    category: 'entertainment',
    occurredOn: daysAgo(7),
    splitMethod: 'equal',
    payers: [{ memberId: rUser, amountCents: 5_200 }],
    split: { method: 'equal', participants: rAll },
    createdByUserId: users.member.id,
  });
  await addExpense({
    id: 'seed-expense-cleaning',
    groupId: GROUP_ROOMIES,
    description: 'Cleaning supplies',
    amountCents: 2_875,
    currency: 'USD',
    category: 'general',
    occurredOn: daysAgo(3),
    splitMethod: 'equal',
    payers: [{ memberId: rOwner, amountCents: 2_875 }],
    split: { method: 'equal', participants: rAll },
    createdByUserId: users.owner.id,
  });

  await db.insert(schema.settlements).values({
    id: 'seed-settlement-1',
    groupId: GROUP_ROOMIES,
    tenantId: TENANT_ID,
    fromMemberId: rAuditor,
    toMemberId: rOwner,
    amountCents: 5_000,
    currency: 'USD',
    note: 'Partial payback via Venmo',
    settledOn: daysAgo(2),
    createdByUserId: users.auditor.id,
    createdAt: daysAgo(2),
  });

  // -------------------------------------------------------------------
  // Group 2 — "Bali Trip": 2 real users + 2 guests, EUR, a guest as
  // payer, a guest settling up, one expense split among only 3 of 4.
  // -------------------------------------------------------------------
  await db.insert(schema.groups).values({
    id: GROUP_TRIP,
    tenantId: TENANT_ID,
    name: 'Bali Trip',
    description: 'June trip with the group.',
    defaultCurrency: 'EUR',
    startDate: daysAgo(40),
    endDate: daysAgo(33),
    createdByUserId: users.owner.id,
    createdAt: daysAgo(45),
    updatedAt: daysAgo(45),
  });

  const tOwner = 'seed-member-t-owner';
  const tAdmin = 'seed-member-t-admin';
  const tSam = 'seed-member-t-sam';
  const tJordan = 'seed-member-t-jordan';
  await db.insert(schema.groupMembers).values([
    {
      id: tOwner,
      groupId: GROUP_TRIP,
      tenantId: TENANT_ID,
      kind: 'user',
      userId: users.owner.id,
      role: 'owner',
      joinedAt: daysAgo(45),
    },
    {
      id: tAdmin,
      groupId: GROUP_TRIP,
      tenantId: TENANT_ID,
      kind: 'user',
      userId: users.admin.id,
      role: 'member',
      joinedAt: daysAgo(45),
    },
    {
      id: tSam,
      groupId: GROUP_TRIP,
      tenantId: TENANT_ID,
      kind: 'guest',
      guestName: 'Sam Rivera',
      guestEmail: 'sam.rivera@example.test',
      guestInviteStatus: 'sent',
      guestOwnerUserId: users.admin.id,
      role: 'member',
      joinedAt: daysAgo(44),
    },
    {
      id: tJordan,
      groupId: GROUP_TRIP,
      tenantId: TENANT_ID,
      kind: 'guest',
      guestName: 'Jordan Lee',
      guestOwnerUserId: users.owner.id,
      role: 'member',
      joinedAt: daysAgo(44),
    },
  ]);
  const tAll = [tOwner, tAdmin, tSam, tJordan];

  await addExpense({
    id: 'seed-expense-flights',
    groupId: GROUP_TRIP,
    description: 'Flights',
    amountCents: 48_000,
    currency: 'EUR',
    category: 'travel',
    occurredOn: daysAgo(40),
    splitMethod: 'equal',
    payers: [{ memberId: tOwner, amountCents: 48_000 }],
    split: { method: 'equal', participants: tAll },
    createdByUserId: users.owner.id,
  });
  await addExpense({
    id: 'seed-expense-hotel',
    groupId: GROUP_TRIP,
    description: 'Hotel — 4 nights',
    amountCents: 62_000,
    currency: 'EUR',
    category: 'travel',
    occurredOn: daysAgo(38),
    splitMethod: 'equal',
    payers: [{ memberId: tAdmin, amountCents: 62_000 }],
    split: { method: 'equal', participants: tAll },
    createdByUserId: users.admin.id,
  });
  await addExpense({
    id: 'seed-expense-dinner',
    groupId: GROUP_TRIP,
    description: 'Dinner at Locavore',
    amountCents: 15_680,
    currency: 'EUR',
    category: 'entertainment',
    occurredOn: daysAgo(36),
    splitMethod: 'equal',
    payers: [{ memberId: tSam, amountCents: 15_680 }], // guest as payer
    split: { method: 'equal', participants: tAll },
    createdByUserId: users.owner.id,
  });
  await addExpense({
    id: 'seed-expense-scooters',
    groupId: GROUP_TRIP,
    description: 'Scooter rental',
    amountCents: 9_000,
    currency: 'EUR',
    category: 'transport',
    occurredOn: daysAgo(35),
    splitMethod: 'amount',
    payers: [{ memberId: tJordan, amountCents: 9_000 }], // guest as payer
    split: {
      method: 'amount',
      amounts: { [tOwner]: 3_000, [tAdmin]: 3_000, [tSam]: 1_500, [tJordan]: 1_500 },
    },
    createdByUserId: users.owner.id,
  });
  await addExpense({
    id: 'seed-expense-beach-club',
    groupId: GROUP_TRIP,
    description: 'Beach club day pass',
    amountCents: 20_000,
    currency: 'EUR',
    category: 'entertainment',
    occurredOn: daysAgo(34),
    splitMethod: 'equal',
    payers: [{ memberId: tAdmin, amountCents: 20_000 }],
    split: { method: 'equal', participants: [tOwner, tAdmin, tSam] }, // Jordan skipped this one
    createdByUserId: users.admin.id,
  });
  await addExpense({
    id: 'seed-expense-souvenirs',
    groupId: GROUP_TRIP,
    description: 'Souvenirs',
    amountCents: 4_560,
    currency: 'EUR',
    category: 'general',
    occurredOn: daysAgo(33),
    splitMethod: 'equal',
    payers: [{ memberId: tOwner, amountCents: 4_560 }],
    split: { method: 'equal', participants: tAll },
    createdByUserId: users.owner.id,
  });

  await db.insert(schema.settlements).values({
    id: 'seed-settlement-2',
    groupId: GROUP_TRIP,
    tenantId: TENANT_ID,
    fromMemberId: tJordan,
    toMemberId: tOwner,
    amountCents: 15_000,
    currency: 'EUR',
    note: 'Bank transfer after the trip',
    settledOn: daysAgo(30),
    createdByUserId: users.owner.id,
    createdAt: daysAgo(30),
  });

  client.close();

  console.log('Seed complete.');
  console.log('  2 groups, 6 group members (4 real + 2 guests), 14 expenses, 2 settlements.');
  console.log('');
  console.log('Sign in as owner@sovereign.local (password: sovereign) to see:');
  console.log(
    '  - "Roomies" (USD) — all 4 real dev accounts, every split method, a partial settlement',
  );
  console.log(
    '  - "Bali Trip" (EUR) — 2 real users + 2 guests, a guest as payer twice, a guest settling up',
  );
}

await main();
