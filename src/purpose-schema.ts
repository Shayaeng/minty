// Purpose-scoped source tables. Read views are defined by migration 0028.
export const PURPOSE_TABLES = {
  "accounts": {
    "pk": [
      "id"
    ],
    "parent": null
  },
  "items": {
    "pk": [
      "id"
    ],
    "parent": null
  },
  "bills": {
    "pk": [
      "id"
    ],
    "parent": null
  },
  "point_balances": {
    "pk": [
      "id"
    ],
    "parent": null
  },
  "securities": {
    "pk": [
      "security_id"
    ],
    "parent": null
  },
  "transactions": {
    "pk": [
      "id"
    ],
    "parent": "account_id"
  },
  "balance_snapshots": {
    "pk": [
      "account_id",
      "date"
    ],
    "parent": "account_id"
  },
  "holdings": {
    "pk": [
      "account_id",
      "security_id"
    ],
    "parent": "account_id"
  },
  "investment_txns": {
    "pk": [
      "id"
    ],
    "parent": "account_id"
  },
  "card_products": {
    "pk": [
      "account_id"
    ],
    "parent": "account_id"
  },
  "benefit_marks": {
    "pk": [
      "account_id",
      "benefit_id",
      "period_start"
    ],
    "parent": "account_id"
  },
  "benefit_credit_periods": {
    "pk": [
      "account_id",
      "benefit_id",
      "transaction_id"
    ],
    "parent": "account_id"
  },
  "card_statements": {
    "pk": [
      "account_id",
      "issue_date"
    ],
    "parent": "account_id"
  },
  "account_lifecycle": {
    "pk": [
      "account_id"
    ],
    "parent": "account_id"
  },
  "account_bonus_offers": {
    "pk": [
      "id"
    ],
    "parent": "account_id"
  },
  "transaction_tags": {
    "pk": [
      "transaction_id",
      "tag"
    ],
    "parent": "transaction_id"
  },
  "account_bonus_requirements": {
    "pk": [
      "id"
    ],
    "parent": "offer_id"
  },
  "account_bonus_payments": {
    "pk": [
      "id"
    ],
    "parent": "offer_id"
  },
  "statement_sync": {
    "pk": [
      "item_id"
    ],
    "parent": "item_id"
  },
  "investment_sync": {
    "pk": [
      "item_id"
    ],
    "parent": "item_id"
  }
} as const;
export const PURPOSE_CACHES = ["monthly_totals", "net_worth", "recurring_charges", "bucket_overrides", "analytics_exclusions"] as const;
