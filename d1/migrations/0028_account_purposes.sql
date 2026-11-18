-- Purpose is an account-level classification. NULL is deliberately Unclassified, including all existing accounts.
ALTER TABLE accounts ADD COLUMN purpose TEXT CHECK (purpose IN ('personal','churning'));
ALTER TABLE accounts ADD COLUMN inventory_only INTEGER NOT NULL DEFAULT 0 CHECK (inventory_only IN (0,1));
CREATE INDEX idx_accounts_item_purpose ON accounts(item_id,purpose);
ALTER TABLE bills ADD COLUMN purpose TEXT CHECK (purpose IN ('personal','churning'));
ALTER TABLE point_balances ADD COLUMN purpose TEXT CHECK (purpose IN ('personal','churning'));


CREATE TABLE legacy_purpose_monthly_totals (
    month        TEXT    NOT NULL,                     -- YYYY-MM
    owner        TEXT    NOT NULL,                     -- MINTY_USERS key
    bucket       TEXT    NOT NULL CHECK (bucket IN ('income', 'spend', 'saving', 'transfer', 'debt')),
    category     TEXT    NOT NULL,                     -- Plaid's primary category, or 'OTHER'
    amount_cents INTEGER NOT NULL,
    n            INTEGER NOT NULL,
    PRIMARY KEY (month, owner, bucket, category)
) WITHOUT ROWID;

CREATE TABLE churning_monthly_totals (
    month        TEXT    NOT NULL,                     -- YYYY-MM
    owner        TEXT    NOT NULL,                     -- MINTY_USERS key
    bucket       TEXT    NOT NULL CHECK (bucket IN ('income', 'spend', 'saving', 'transfer', 'debt')),
    category     TEXT    NOT NULL,                     -- Plaid's primary category, or 'OTHER'
    amount_cents INTEGER NOT NULL,
    n            INTEGER NOT NULL,
    PRIMARY KEY (month, owner, bucket, category)
) WITHOUT ROWID;

INSERT INTO legacy_purpose_monthly_totals SELECT * FROM monthly_totals;

DELETE FROM monthly_totals;

CREATE TABLE legacy_purpose_net_worth (
    date         TEXT    NOT NULL,                     -- YYYY-MM-DD (UTC)
    owner        TEXT    NOT NULL,
    assets_cents INTEGER NOT NULL,
    debts_cents  INTEGER NOT NULL,                     -- what's owed, positive
    PRIMARY KEY (date, owner)
) WITHOUT ROWID;

CREATE TABLE churning_net_worth (
    date         TEXT    NOT NULL,                     -- YYYY-MM-DD (UTC)
    owner        TEXT    NOT NULL,
    assets_cents INTEGER NOT NULL,
    debts_cents  INTEGER NOT NULL,                     -- what's owed, positive
    PRIMARY KEY (date, owner)
) WITHOUT ROWID;

INSERT INTO legacy_purpose_net_worth SELECT * FROM net_worth;

DELETE FROM net_worth;

CREATE TABLE legacy_purpose_recurring_charges (
    owner           TEXT    NOT NULL,
    merchant        TEXT    NOT NULL,                  -- upper(merchant_name, else name), as bucket_overrides
    name            TEXT,                              -- as the newest charge shows it
    category        TEXT,
    cadence         TEXT    NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'quarterly', 'yearly')),
    n               INTEGER NOT NULL,                  -- charges seen
    avg_cents       INTEGER NOT NULL,
    last_cents      INTEGER NOT NULL,
    prev_cents      INTEGER,                           -- the charge before the newest
    distinct_amounts INTEGER NOT NULL,                 -- few means a fixed price (a rise is worth flagging)
    first_date      TEXT    NOT NULL,
    last_date       TEXT    NOT NULL,
    PRIMARY KEY (owner, merchant)
) WITHOUT ROWID;

CREATE TABLE churning_recurring_charges (
    owner           TEXT    NOT NULL,
    merchant        TEXT    NOT NULL,                  -- upper(merchant_name, else name), as bucket_overrides
    name            TEXT,                              -- as the newest charge shows it
    category        TEXT,
    cadence         TEXT    NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'quarterly', 'yearly')),
    n               INTEGER NOT NULL,                  -- charges seen
    avg_cents       INTEGER NOT NULL,
    last_cents      INTEGER NOT NULL,
    prev_cents      INTEGER,                           -- the charge before the newest
    distinct_amounts INTEGER NOT NULL,                 -- few means a fixed price (a rise is worth flagging)
    first_date      TEXT    NOT NULL,
    last_date       TEXT    NOT NULL,
    PRIMARY KEY (owner, merchant)
) WITHOUT ROWID;

INSERT INTO legacy_purpose_recurring_charges SELECT * FROM recurring_charges;

DELETE FROM recurring_charges;

CREATE TABLE legacy_purpose_bucket_overrides (
    merchant   TEXT PRIMARY KEY,                       -- upper(merchant_name, else name)
    bucket     TEXT NOT NULL CHECK (bucket IN ('income', 'spend', 'saving', 'transfer', 'debt')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE churning_bucket_overrides (
    merchant   TEXT PRIMARY KEY,                       -- upper(merchant_name, else name)
    bucket     TEXT NOT NULL CHECK (bucket IN ('income', 'spend', 'saving', 'transfer', 'debt')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO legacy_purpose_bucket_overrides SELECT * FROM bucket_overrides;

DELETE FROM bucket_overrides;

CREATE TABLE legacy_purpose_analytics_exclusions (
    kind       TEXT NOT NULL CHECK (kind IN ('tag', 'bank', 'account')),
    value      TEXT NOT NULL,                          -- the tag as spelled, or items.id / accounts.id
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (kind, value)
) WITHOUT ROWID;

CREATE TABLE churning_analytics_exclusions (
    kind       TEXT NOT NULL CHECK (kind IN ('tag', 'bank', 'account')),
    value      TEXT NOT NULL,                          -- the tag as spelled, or items.id / accounts.id
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (kind, value)
) WITHOUT ROWID;

INSERT INTO legacy_purpose_analytics_exclusions SELECT * FROM analytics_exclusions;

DELETE FROM analytics_exclusions;

CREATE TABLE churning_app_state (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE legacy_purpose_app_state AS SELECT * FROM app_state WHERE key LIKE 'audit_%' OR key LIKE 'retirement_profile:%' OR key='networth_dirty';

DELETE FROM app_state WHERE key LIKE 'audit_%' OR key LIKE 'retirement_profile:%' OR key='networth_dirty';

INSERT INTO app_state (key,value) VALUES ('audit_dirty',NULL),('networth_dirty',NULL);

INSERT INTO churning_app_state (key,value) VALUES ('audit_dirty',NULL),('networth_dirty',NULL);

CREATE VIEW purpose_personal_accounts AS SELECT id,owner,item_id,plaid_account_id,name,mask,type,subtype,CASE WHEN inventory_only=1 THEN NULL ELSE balance_current_cents END AS balance_current_cents,CASE WHEN inventory_only=1 THEN NULL ELSE balance_available_cents END AS balance_available_cents,currency,updated_at,view,display_name,is_manual,holder_name,beneficiary_name,responsible_adult_name,detailed_type,institution_manual,balance_as_of,notes,login_url,holder_ids,beneficiary_id,responsible_adult_id,purpose,inventory_only FROM accounts WHERE purpose='personal';

CREATE VIEW purpose_churning_accounts AS SELECT id,owner,item_id,plaid_account_id,name,mask,type,subtype,CASE WHEN inventory_only=1 THEN NULL ELSE balance_current_cents END AS balance_current_cents,CASE WHEN inventory_only=1 THEN NULL ELSE balance_available_cents END AS balance_available_cents,currency,updated_at,view,display_name,is_manual,holder_name,beneficiary_name,responsible_adult_name,detailed_type,institution_manual,balance_as_of,notes,login_url,holder_ids,beneficiary_id,responsible_adult_id,purpose,inventory_only FROM accounts WHERE purpose='churning';

CREATE VIEW purpose_personal_items AS SELECT * FROM items WHERE EXISTS (SELECT 1 FROM accounts p WHERE p.item_id=items.id AND p.purpose='personal');

CREATE VIEW purpose_churning_items AS SELECT * FROM items WHERE EXISTS (SELECT 1 FROM accounts p WHERE p.item_id=items.id AND p.purpose='churning');

CREATE VIEW purpose_personal_bills AS SELECT * FROM bills WHERE purpose='personal';

CREATE VIEW purpose_churning_bills AS SELECT * FROM bills WHERE purpose='churning';

CREATE VIEW purpose_personal_point_balances AS SELECT * FROM point_balances WHERE purpose='personal';

CREATE VIEW purpose_churning_point_balances AS SELECT * FROM point_balances WHERE purpose='churning';

CREATE VIEW purpose_personal_securities AS SELECT * FROM securities WHERE security_id IN (SELECT security_id FROM purpose_personal_holdings UNION SELECT security_id FROM purpose_personal_investment_txns);

CREATE VIEW purpose_churning_securities AS SELECT * FROM securities WHERE security_id IN (SELECT security_id FROM purpose_churning_holdings UNION SELECT security_id FROM purpose_churning_investment_txns);

CREATE VIEW purpose_personal_transactions AS SELECT * FROM transactions WHERE EXISTS (SELECT 1 FROM purpose_personal_accounts p WHERE p.id=transactions.account_id);

CREATE VIEW purpose_churning_transactions AS SELECT * FROM transactions WHERE EXISTS (SELECT 1 FROM purpose_churning_accounts p WHERE p.id=transactions.account_id);

CREATE VIEW purpose_personal_balance_snapshots AS SELECT * FROM balance_snapshots WHERE EXISTS (SELECT 1 FROM purpose_personal_accounts p WHERE p.id=balance_snapshots.account_id) AND account_id IN (SELECT id FROM purpose_personal_accounts WHERE inventory_only=0);

CREATE VIEW purpose_churning_balance_snapshots AS SELECT * FROM balance_snapshots WHERE EXISTS (SELECT 1 FROM purpose_churning_accounts p WHERE p.id=balance_snapshots.account_id) AND account_id IN (SELECT id FROM purpose_churning_accounts WHERE inventory_only=0);

CREATE VIEW purpose_personal_holdings AS SELECT * FROM holdings WHERE EXISTS (SELECT 1 FROM purpose_personal_accounts p WHERE p.id=holdings.account_id);

CREATE VIEW purpose_churning_holdings AS SELECT * FROM holdings WHERE EXISTS (SELECT 1 FROM purpose_churning_accounts p WHERE p.id=holdings.account_id);

CREATE VIEW purpose_personal_investment_txns AS SELECT * FROM investment_txns WHERE EXISTS (SELECT 1 FROM purpose_personal_accounts p WHERE p.id=investment_txns.account_id);

CREATE VIEW purpose_churning_investment_txns AS SELECT * FROM investment_txns WHERE EXISTS (SELECT 1 FROM purpose_churning_accounts p WHERE p.id=investment_txns.account_id);

CREATE VIEW purpose_personal_card_products AS SELECT * FROM card_products WHERE EXISTS (SELECT 1 FROM purpose_personal_accounts p WHERE p.id=card_products.account_id);

CREATE VIEW purpose_churning_card_products AS SELECT * FROM card_products WHERE EXISTS (SELECT 1 FROM purpose_churning_accounts p WHERE p.id=card_products.account_id);

CREATE VIEW purpose_personal_benefit_marks AS SELECT * FROM benefit_marks WHERE EXISTS (SELECT 1 FROM purpose_personal_accounts p WHERE p.id=benefit_marks.account_id);

CREATE VIEW purpose_churning_benefit_marks AS SELECT * FROM benefit_marks WHERE EXISTS (SELECT 1 FROM purpose_churning_accounts p WHERE p.id=benefit_marks.account_id);

CREATE VIEW purpose_personal_benefit_credit_periods AS SELECT * FROM benefit_credit_periods WHERE EXISTS (SELECT 1 FROM purpose_personal_accounts p WHERE p.id=benefit_credit_periods.account_id);

CREATE VIEW purpose_churning_benefit_credit_periods AS SELECT * FROM benefit_credit_periods WHERE EXISTS (SELECT 1 FROM purpose_churning_accounts p WHERE p.id=benefit_credit_periods.account_id);

CREATE VIEW purpose_personal_card_statements AS SELECT * FROM card_statements WHERE EXISTS (SELECT 1 FROM purpose_personal_accounts p WHERE p.id=card_statements.account_id);

CREATE VIEW purpose_churning_card_statements AS SELECT * FROM card_statements WHERE EXISTS (SELECT 1 FROM purpose_churning_accounts p WHERE p.id=card_statements.account_id);

CREATE VIEW purpose_personal_account_lifecycle AS SELECT * FROM account_lifecycle WHERE EXISTS (SELECT 1 FROM purpose_personal_accounts p WHERE p.id=account_lifecycle.account_id);

CREATE VIEW purpose_churning_account_lifecycle AS SELECT * FROM account_lifecycle WHERE EXISTS (SELECT 1 FROM purpose_churning_accounts p WHERE p.id=account_lifecycle.account_id);

CREATE VIEW purpose_personal_account_bonus_offers AS SELECT * FROM account_bonus_offers WHERE EXISTS (SELECT 1 FROM purpose_personal_accounts p WHERE p.id=account_bonus_offers.account_id);

CREATE VIEW purpose_churning_account_bonus_offers AS SELECT * FROM account_bonus_offers WHERE EXISTS (SELECT 1 FROM purpose_churning_accounts p WHERE p.id=account_bonus_offers.account_id);

CREATE VIEW purpose_personal_transaction_tags AS SELECT * FROM transaction_tags WHERE EXISTS (SELECT 1 FROM purpose_personal_transactions p WHERE p.id=transaction_tags.transaction_id);

CREATE VIEW purpose_churning_transaction_tags AS SELECT * FROM transaction_tags WHERE EXISTS (SELECT 1 FROM purpose_churning_transactions p WHERE p.id=transaction_tags.transaction_id);

CREATE VIEW purpose_personal_account_bonus_requirements AS SELECT * FROM account_bonus_requirements WHERE EXISTS (SELECT 1 FROM purpose_personal_account_bonus_offers p WHERE p.id=account_bonus_requirements.offer_id);

CREATE VIEW purpose_churning_account_bonus_requirements AS SELECT * FROM account_bonus_requirements WHERE EXISTS (SELECT 1 FROM purpose_churning_account_bonus_offers p WHERE p.id=account_bonus_requirements.offer_id);

CREATE VIEW purpose_personal_account_bonus_payments AS SELECT * FROM account_bonus_payments WHERE EXISTS (SELECT 1 FROM purpose_personal_account_bonus_offers p WHERE p.id=account_bonus_payments.offer_id);

CREATE VIEW purpose_churning_account_bonus_payments AS SELECT * FROM account_bonus_payments WHERE EXISTS (SELECT 1 FROM purpose_churning_account_bonus_offers p WHERE p.id=account_bonus_payments.offer_id);

CREATE VIEW purpose_personal_statement_sync AS SELECT * FROM statement_sync WHERE EXISTS (SELECT 1 FROM purpose_personal_items p WHERE p.id=statement_sync.item_id);

CREATE VIEW purpose_churning_statement_sync AS SELECT * FROM statement_sync WHERE EXISTS (SELECT 1 FROM purpose_churning_items p WHERE p.id=statement_sync.item_id);

CREATE VIEW purpose_personal_investment_sync AS SELECT * FROM investment_sync WHERE EXISTS (SELECT 1 FROM purpose_personal_items p WHERE p.id=investment_sync.item_id);

CREATE VIEW purpose_churning_investment_sync AS SELECT * FROM investment_sync WHERE EXISTS (SELECT 1 FROM purpose_churning_items p WHERE p.id=investment_sync.item_id);

CREATE TRIGGER purpose_move_invalidates AFTER UPDATE OF purpose,inventory_only ON accounts WHEN OLD.purpose IS NOT NEW.purpose OR OLD.inventory_only IS NOT NEW.inventory_only BEGIN DELETE FROM monthly_totals; DELETE FROM net_worth; DELETE FROM recurring_charges; DELETE FROM churning_monthly_totals; DELETE FROM churning_net_worth; DELETE FROM churning_recurring_charges; INSERT INTO app_state (key,value) VALUES ('audit_dirty','1'),('networth_dirty','1'),('audit_purpose_dirty','1') ON CONFLICT(key) DO UPDATE SET value='1'; INSERT INTO churning_app_state (key,value) VALUES ('audit_dirty','1'),('networth_dirty','1'),('audit_purpose_dirty','1') ON CONFLICT(key) DO UPDATE SET value='1'; END;
