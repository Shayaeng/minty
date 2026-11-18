# Incorporated upstream updates

This fork incorporates the functional changes from `rg-code/minty` after
`2edf04b0bf8787e7af405d9266eeee833b96a2fa` through
`44f5e7eab10f3145aae1171bd3992306f61dd503` (November 9, 2026).
The upstream redeployment-only commit `7cf93e2` has no code changes to incorporate.

Included changes:

- Refused API sign-ins explain the error instead of showing sample transactions.
- Benefit matching uses authorization dates when available, with explicit benefit-credit period corrections.
- Spending cards show running totals against an average month, with prior-year context and clearer chart labels.
- Selection summaries handle refunds less a fee, changed-then-refunded purchases, and card-member breakdowns.
- The snapshot read-budget test uses a fixed midday timestamp to avoid midnight-only failures.

The existing Accounts/Transactions navigation, D1 household people, manual accounts,
valuation dates, exclusions and setup pages remain intact.

## Migration mapping

Do not add or rename already-applied migrations to match upstream numbering.

| Upstream migration | Migration in this fork |
| --- | --- |
| `0021_authorized_date.sql` | `0024_authorized_date.sql` |
| `0022_benefit_credit_periods.sql` | `0025_benefit_credit_periods.sql` |

Older transaction rows retain a null authorization date and fall back to posting date.
Plaid supplies authorization dates for new or changed transactions; this update does
not relink banks or backfill previously downloaded history.

Validation: TypeScript, the complete Worker/D1 regression suite, and real-browser
manual-account/navigation and sign-in refusal/recovery tests. Browser tests use only
the isolated local D1 database and do not exercise live Plaid credentials.
