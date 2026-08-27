# Tally — concept

**Status:** Concept (pre-RFC, pre-roadmap)\
**Date:** 2026-08-26\
**Scope:** A new Sovereign plugin (`.local` dev plugin in this checkout,
externally-maintained-style — same pattern as `sovereign-plugin-tasks.local`).
No epic task or RFC exists yet; this doc is the starting point for both.\
**Closest reference:** [Splitwise](https://www.splitwise.com/) — see also the
open-source alternatives researched alongside it: Spliit, Tricount, IHateMoney.

---

## 1. Problem

Splitting shared expenses across a group of people — roommates, a trip,
a friend circle, a household — breaks down fast once it moves past mental
math or a shared note. Two costs compound:

- **Financial cost**: tracking who paid what and who owes whom, especially
  across many small transactions over weeks or months.
- **Social cost**: this is usually higher than the financial cost. Nobody
  wants to be the friend who brings up a $12 debt from three weeks ago.
  A neutral, always-up-to-date ledger everyone can see removes the
  awkwardness of asking.

Splitwise solved this well enough to become the default answer, but its
free tier has degraded: a daily cap on new expenses (~3/day), ads, and
core features (receipt scanning, search, spending charts, currency
conversion) paywalled behind Splitwise Pro. Every open-source alternative
that has gained traction (Spliit, Tricount, IHateMoney) markets itself
explicitly against those limits — "no ads, no limits, no paywall."

## 2. Solution — what Tally is

Tally is Sovereign's shared-expense-tracking plugin: groups, expenses,
flexible splits, running balances, debt simplification, and settle-up
recording — the Splitwise mental model, without Splitwise's monetization
friction, running on infrastructure the user already owns.

**Why this is a good fit for Sovereign specifically, not just "another
Splitwise clone":**

- **No forced onboarding friction.** Splitwise and Spliit both have to
  solve "how does a non-user join a group" as a first-class problem
  (invite by email/link). On a Sovereign instance, most group members are
  already platform users — a group is just a set of existing accounts.
  Non-instance participants (a friend who isn't on this Sovereign
  instance) should still be supported as lightweight named "guest"
  members, mirroring Splitwise/Spliit's guest-friendliness — but that's
  the exception path, not the primary one.
- **No artificial scarcity.** Self-hosted, single-tenant, no ad
  inventory to sell — there is no daily-expense-cap-shaped business
  reason to exist. Per the developer's instruction, **v1 ships with no
  Pro/paid tier at all** — every feature below is available to every
  user. A paid-subscription model may be revisited later (Sovereign's
  manifest schema already has a generic plugin pricing/monetization
  primitive — see §6), but it is explicitly not a v1 concern and should
  not shape any v1 design decision.
- **Data stays on the instance.** No third-party account required to
  participate in tracking money owed between people who already trust
  each other with a shared Sovereign instance.

## 3. Competitive positioning

| | Splitwise | Spliit | Tricount | IHateMoney | **Tally (v1 target)** |
|---|---|---|---|---|---|
| Split methods | equal/amount/%/shares | %/shares/amount/advanced | equal/amount/shares | per-person weight | equal/amount/%/shares |
| Account required | Yes | No (link = group) | Yes | No | Sovereign session (existing users); lightweight guest members |
| Ads / paywall | Yes (free tier) | None | None | None | **None** |
| Debt simplification | Yes | Yes | Yes | Yes | Yes |
| Multi-currency | Pro only | Basic | Automatic conversion | Limited | Yes (manual, ISO 4217) |
| Receipt attach | Pro only (scan) | Yes (+AI scan, beta) | Manual photo | No | Manual image attach only (v1) |
| Recurring expenses | No | Yes | No | No | Out of scope v1 (see §6) |
| Stats/charts | Pro only | No | Yes | Requested, not shipped | Out of scope v1 (see §6) |

Splitwise is the closest match in scope and is the primary bar to clear.
The open-source alternatives confirm the table-stakes feature set
(splitting methods, groups, debt simplification, settle-up) is
well-understood and not risky to build; Tally's differentiation is
distribution (bundled into a platform the user already runs), not novel
mechanics.

## 4. V1 feature scope

Matches Splitwise's free-tier mental model, with none of its limits.

### Groups
- Create a group per shared context (household, trip, recurring friend
  group). A user can belong to many groups.
- Members are either existing Sovereign accounts on the instance, or
  lightweight **guest members** (name only, no login) for people outside
  the instance — someone still needs an owning member to manage a
  guest's share.
- Each group tracks its own balances independently.

### Expenses
- Add an expense: description, amount, currency, who paid (one or more
  payers), date, optional category, optional note, optional receipt
  image.
- Split methods: **equal**, **exact amount**, **percentage**, **shares**
  — matching Splitwise's own set. Default to equal, per Splitwise/Spliit
  precedent.
- Edit/delete an expense (with an activity trail — who changed what).

### Balances & settling
- Running per-member balance within a group ("you owe / you are owed").
- **Debt simplification**: net down chains of debt within a group to the
  minimum number of payments (Splitwise's core "clever" feature — table
  stakes, not a differentiator, but must be there).
- **Record a settlement**: log that a payment happened outside the app
  (cash, bank transfer, whatever) to zero out a balance. Tally does not
  move money itself — same as Splitwise, Spliit, Tricount, and
  IHateMoney, none of which touch real payment rails. This also keeps
  Tally clear of any actual financial-transaction surface.

### Multi-currency
- Each expense carries an ISO 4217 currency code (matching the
  convention already used by the platform's own plugin-pricing schema in
  `packages/manifest`). Manual currency selection per expense; no
  automatic FX-rate conversion in v1 (Tricount's live conversion is
  explicitly a post-v1 nice-to-have, not a v1 requirement).

### Categories
- A small fixed set of expense categories (rent, groceries, transport,
  entertainment, utilities, other — refine during design) for basic
  organization. No charts/analytics on top of them in v1 (see §6).

## 5. Sovereign platform fit (SDK surface likely needed)

Rough read of `packages/sdk/src/`, to be confirmed once implementation
starts:

- `db.ts` — plugin's own tables (groups, memberships, expenses, splits,
  settlements). Isolated or shared DB mode is a decision for the RFC, not
  this doc.
- `auth.ts` / `authz.ts` — every server action must authorize inside the
  action itself (session + capability check), per the platform's
  hard rule — group membership is the natural authorization boundary
  here (a user may only read/write expenses in groups they belong to).
- `notifications.ts` — "you were added to a group," "an expense was
  added," "you were sent a settle-up request" (Splitwise/Tricount both
  send these).
- `storage.ts` — receipt image attachments.
- `activity.ts` — expense edit history / audit trail.
- `data.ts` (cross-plugin data contracts, RFC 0002) — a natural future
  seam to a personal-finance plugin if one ever exists, not needed for
  v1.

No blocking platform gap identified yet (unlike the trip-planning concept,
which needed a map primitive that doesn't exist) — Tally's v1 scope looks
buildable entirely on primitives the platform already has.

## 6. Explicitly out of scope for v1 (non-goals)

Per direct instruction: **no Pro/paid tier consideration at all for v1** —
not a feature flag, not a stubbed gate, nothing. Build every feature above
as available to everyone. Revisit monetization only if/when explicitly
asked to, as a separate concept/RFC pass — the platform's generic plugin
pricing primitive (`packages/manifest` `pricing` schema: `free` /
`one_time` / `recurring` / `pay_what_you_want` models with ISO 4217
`currency`) already exists for that day, so there's no need to design
around it prematurely now.

Also deferred, in rough priority order if this becomes a real roadmap
item:

1. **AI/OCR receipt scanning** (Splitwise Pro, Spliit beta) — real value,
   but an external-API dependency and cost surface not needed to match
   core Splitwise parity.
2. **Recurring expenses** (Spliit has it, Splitwise doesn't) — nice, not
   required to match the primary competitor.
3. **Automatic currency conversion** (Tricount) — v1 is manual currency
   selection only, with **no exception** — including the Overview/People
   aggregation rollup (see below), which shows per-currency totals rather
   than converting (revised 2026-08-26, reversing an earlier draft of this
   doc that carved out a display-only conversion exception there).
4. **Splitwise data import** — both Spliit and Tricount built this as a
   competitive on-ramp; worth considering once Tally is otherwise
   feature-complete, not before.
5. **Real payment-rail integration** (actually moving money) — no
   competitor does this either; stays purely a ledger, indefinitely, not
   just for v1.

**Revised 2026-08-26 — spending charts/statistics are now in v1 scope**,
reversing this doc's original position. The original reasoning ("explicitly
a Pro-tier feature in Splitwise, skip for the same reason Pro itself is
skipped") doesn't actually hold once you take the "no Pro tier at all"
decision above seriously — there's no paywall for a stats feature to sit
behind, so withholding it buys nothing. Overview now includes spend-by-
category, monthly/yearly trend, and a net-owed/owed rollup — see
[SPEC.md](SPEC.md) §4 for the aggregation queries this needs and
[UI-FLOW.md](UI-FLOW.md) for the screen design.

## 7. Open questions

- **Guest members**: exact model for a non-instance participant (owned by
  which member? can they ever "claim" the guest identity later if they
  join the instance?).
- **DB isolation mode**: shared platform DB vs. isolated per-plugin DB —
  needs the same analysis every other plugin RFC does.
- **Group-level vs. friend-level balances**: Splitwise shows both a
  per-group balance and an overall cross-group balance per friend. Decide
  whether v1 needs the cross-group rollup or just per-group.
- **Naming**: "Tally" as the plugin id/display name — confirm it doesn't
  collide with anything in `registry/plugins.json` or trademark-adjacent
  concerns before this goes further than a `.local` dev plugin. Lower risk
  than first assumed: `sovereign-tally` already appears, consistently, as
  one of a standing roster of externally-maintained first-party app names
  used across this repo's own docs (`docs/rfcs/0068-export-completeness-
  hardening.md`, `docs/rfcs/0081-per-plugin-installable-pwa.md`,
  `docs/epics/design-system.md`, `docs/research/0006-standalone-plugin-
  apps.md`) — alongside `sovereign-tasks`, `sovereign-shopper`,
  `sovereign-wallet`, `sovereign-healthlog`, `sovereign-tritext`,
  `sovereign-plainwrite`, and `sovereign-docs`. Whether those were
  originally illustrative placeholders or reflect real sibling
  repositories this session can't see, the name has been in consistent use
  internally — an external registry/trademark check is still the open
  item, not an internal collision.

## Next step

Turn §4–§5 into a data-model sketch (tables + relationships) and, once
that's stable, a research doc under `docs/research/` if this is going to
be proposed as a real roadmap item — following the same
research → RFC → epic pipeline as every other plugin concept.
