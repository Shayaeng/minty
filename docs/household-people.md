# Household people and manual accounts

Manage people at `/add-user`. Add, rename, reorder, archive, or restore people without changing Cloudflare. A person is an organizing identity, not a login. Existing Cloudflare Access policies and `ALLOWED_LOGINS` continue to control admission to the entire household's data.

On the first authenticated API request or scheduled run after migration 0023, Minty imports `MINTY_USERS` into `household_people`, preserving every ID, including `me`. It also preserves owners already referenced by saved accounts and connections. An atomic `people_imported` marker makes this a one-time import. D1 is authoritative afterwards: editing `MINTY_USERS` cannot overwrite names or ordering. Renaming and archiving never change IDs or Plaid credential suffixes. Archived people retain account references and existing connections continue syncing.

Account holder(s), beneficiary, responsible adult, and household grouping are separate fields. New relationships select person IDs. Older free-text relationship names remain visible until explicitly edited. Archiving is reversible; there is no delete action.

`/connections-setup` contains technical checks, the browser-only encryption-key generator, and the exact Plaid secret names for each immutable person ID. These are optional for manual-only households. Secret values remain in Cloudflare; the frontend receives only configuration status. Adding a person grants neither login access nor Plaid access.

Accounts uses the shared catalog in `public/account-types.js` for categories and asset/debt classification. It never guesses tax treatment from account names. Broad legacy manual investments migrate to Other investment / unclassified. Edit them at `/manual?edit=<id>` to identify their detailed type. Checking & savings, retirement, taxable brokerage, education, HSA, custodial accounts, debts and unclassified assets have separate summary filters. Totals respect the person filter and account/bank exclusions, count each account once, and keep currencies separate.

Manual accounts support institution, nickname, type, person relationships, mask, currency, balance, valuation date, notes and an optional HTTP(S) login URL. Saving refreshes snapshots and current net worth. Snapshot dates and displayed balance dates use the entered valuation date; background snapshots do not make old manual valuations look new. Net worth is a current overview using the latest entered values, not a currency conversion or a live appraisal. EGG retains its existing treatment of HSA accounts; the Accounts page categorizes HSAs separately from retirement.

## Local verification

Run `npm test`, then `npx wrangler types` and `npx tsc --noEmit`.

`npm run test:e2e:household` applies migrations only to `.wrangler/household-e2e` and runs the real browser forms, person management, all 24 manual types, valuation edits, navigation and mobile layout. It uses installed Edge on Windows; elsewhere install Playwright Chromium (`npx playwright install chromium`). `PLAYWRIGHT_CHANNEL` can select another installed browser. The generated, ignored `.wrangler-household-e2e.jsonc` raises only local automation rate limits. It is never the deployment config. No Plaid credentials, transactions, production data, or Cloudflare changes are needed.
