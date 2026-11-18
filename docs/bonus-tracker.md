# Account-opening bonus tracker

Open **Accounts → Bonus tracker**, or use **Opening & bonus details** on any saved account.
This works for manual and connected accounts, including accounts without transactions or Plaid credentials.
The existing person subtabs also filter the tracker by account relationships.

Account opening date, Yes/No/Unknown opening-bonus answer, Open/Closed status, closed date,
monthly fee and fee-waiver requirements belong to the financial account. They are stored separately
from Plaid-owned data. Changing status to Closed does not overwrite a saved balance; update a manual
balance separately if necessary.

Each account can have multiple offers. Offers hold the name, URL, expected amount and currency,
expected payout date, notes, optional original terms text, minimum-open-period notes, holding rule
and an optional manual closure-date override. Changing the opening-bonus answer does not delete
previously saved offers. Original terms are stored as plain text, as entered, up to 48,000 characters
and the 64 KiB offer-request limit. Other API writes retain the existing 16 KiB limit.

Requirements and payments are independent child records with stable IDs. Requirements have their
own deadlines and completion dates. Multiple receipts support installments, corrections and partial
settlements. A receipt may have an unknown amount or date, but must record at least one. Unknown
amounts remain unknown; the UI can show the known subtotal without inventing a total. An offer's
currency cannot change while receipts are recorded.

## Holding dates and indicators

No holding-period trigger is assumed. A calculated date requires an explicit trigger, length, unit,
and rule/source from the offer terms. Choose account opening, first recorded bonus payment, latest
recorded bonus payment, or an explicit trigger date. Unknown dates on any receipt prevent a first/latest
payment date from being inferred. Calendar months clamp to the last day of a shorter month; days use
date-only arithmetic without time-of-day or daylight-saving shifts.

A manual date requires a source/explanation and can override a calculation. The calculation remains
visible for comparison. Complex terms can be recorded in the original terms/notes and resolved with
an explained manual date; Minty does not interpret prose or determine permission to close.

The labels are **Keep open until [date]**, **Closure date reached — review terms**, and
**Closure terms unknown**. An account is never labelled safe to close. Account-wide closure summaries
consider every saved offer: the latest known date governs known obligations, and any unknown offer
prevents the account-wide date-reached state. A known future obligation remains visible even when
another offer's terms are unknown.

Requirement completion does not mark a bonus paid. Receiving a bonus does not complete requirements
or grant permission to close. Expected/received tracker amounts do not change balances, net worth,
transactions or monthly fees. Actual money movement remains the responsibility of Plaid sync or
manual balance updates. Mark payment complete/settled explicitly when the expected amount is unknown
or an agreed partial settlement finishes the offer.

Deadlines are date-only. A requirement or expected payout is overdue only after its date, not during
the due date. The browser supplies its local date and refreshes day-based indicators after midnight
or when returning to the page. These are in-app indicators only; no email or push notifications exist.

Requirement and payment filters apply per offer. Keep-open and date-reached filters consider all
offers on an account. Closed-account filtering uses the independently saved account status. The
tracker can show several rows for one account, but never duplicates the financial account or adds
expected bonuses to the inventory's currency totals.

## Storage and checks

Migrations `0026_account_bonuses.sql` and `0027_bonus_payment_unknowns.sql` add the lifecycle/offer
records and preserve receipt IDs and values while allowing unknown payment fields. Existing account
identities, balances, household assignments and Plaid connections remain unchanged.

The authenticated `/account-bonuses` API returns the tracker. Lifecycle edits use
`PUT /accounts/{id}/lifecycle`. Offers, requirements and payments have separate routes under
`/account-bonuses/`. The existing `/accounts` API continues returning financial accounts as JSON.

Run `npm test`, `npx wrangler types`, `npx tsc --noEmit`, and `npm run test:e2e:household`.
Tests cover calendar boundaries, distinct triggers, unknown terms/dates/amounts, partial payments,
overdue cutoffs, multiple offers, overrides, preserving financial records, and the real mobile browser flow.
