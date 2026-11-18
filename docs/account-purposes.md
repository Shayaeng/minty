# Personal and Churning

The switch at the top of every Minty page selects **Personal** or **Churning**.
Personal is the first-use default. The choice stays on this device across pages,
dialogs, reloads and back navigation. Person filters are separate: Everyone means
everyone within the selected purpose. There is no combined financial view.

Purpose belongs to each individual account. One Citi login can contain a Personal
credit card, a Churning credit card and a Churning checking account. Institution,
household person, holder, beneficiary, responsible adult and account type do not
determine purpose. Connection administration and household people remain shared;
this feature does not change who can sign in.

After upgrading, choose **Finish account setup**. Existing accounts are deliberately
Unclassified, including closed accounts. They retain all records but contribute to
neither purpose until chosen. The same action appears for newly discovered Plaid
accounts. After linking, setup lists accounts individually, with institution,
type and last four digits. Bulk assignment allows individual overrides. Leaving
before saving keeps those accounts Unclassified. Saved choices survive sync and
reconnection. More than 100 accounts save in resumable batches.

Manual entry shows a required, editable purpose prefilled from the selected view.
Inventory-only mode can save an account without a balance; previously saved
balances and snapshots remain stored when this mode is enabled, but are excluded
from financial calculations. All of this works without Plaid credentials.

Use **Move to Personal/Churning** in Accounts, or edit a manual account's purpose.
Changing purpose moves the account's entire transaction, balance and bonus history.
It changes a classification on the original account: it does not copy financial
accounts, transactions, offers, requirements or payments. Closed accounts retain
their purpose. Expected bonuses remain separate from balances and net worth.

Standalone bills and points readings have their own purpose because they have no
financial account foreign key. Existing standalone records require setup; newly
entered readings and bills use the active purpose. Card statements, card benefits,
bill payment matching and card-derived points follow their account's purpose.

## Server enforcement and migration

`src/index.ts` wraps every financial API handler's D1 connection with
`purposeDatabase` from `src/purpose.ts`. Requests select exactly one purpose using
`x-minty-purpose` or `?purpose=`; mismatches and combined values are rejected.
Absent either, the server defaults to Personal. Financial responses identify their
purpose, and the browser refuses successful responses with a mismatched/missing
identifier. Switching hides the old page before reload; API data is never cached by
the service worker. Failed requests do not fall back to sample financial data.

Migration `0028_account_purposes.sql` adds nullable account classifications without
assigning existing accounts. It creates account-based read views for source tables,
including nested transaction tags, offers, requirements, payments and securities.
The shared database wrapper applies those views to reads, and membership guards
to mutations. Financial handlers use that connection rather than opt-in filters.
`src/purpose-schema.ts` lists the covered source and cache tables; the schema
coverage regression test requires new tables to be classified explicitly.

Personal and Churning use independent totals, net-worth history, recurring charges,
merchant corrections, exclusions, audit checklist and retirement profiles. Legacy
derived data and preferences are archived in `legacy_purpose_*` tables. Relevant
legacy preferences are copied once when an account is classified. Account-specific
exclusions move with accounts; merchant/tag/bank preferences remain specific to
each purpose. Changes atomically invalidate both sets of derived totals, refresh
current balances, and rebuild financial history from scoped snapshots on the next
audit read. Archived aggregate history is not reused as a combined total; detailed
account snapshots remain the source for rebuilding history.

Plaid sync, statement sync and investment sync deliberately use the original
database and fetch each login normally, once. Their account upserts do not write
purpose, so imported accounts start NULL and existing classifications survive.
Scheduled analytics run separately for each purpose. Account setup exposes only
identifying metadata across purposes; connection administration exposes shared
login configuration/health, with financial download counts restricted to the
selected purpose. Capacity and rate/read budgets remain household infrastructure.

## Validation

Run `npm test`, `npx wrangler types`, `npx tsc --noEmit`, and
`npm run test:e2e:household`. Browser tests use only the isolated local D1 under
`.wrangler/household-e2e`, without Plaid credentials. The mixed Citi browser fixture
is inserted locally and removed after the test. No remote migrations or deployment
are required to run these checks.
