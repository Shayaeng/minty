-- Lifecycle and offer records never write financial balances or Plaid-owned fields.
CREATE TABLE account_lifecycle (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  opened_date TEXT,
  bonus_answer TEXT NOT NULL DEFAULT 'unknown' CHECK (bonus_answer IN ('yes','no','unknown')),
  account_status TEXT NOT NULL DEFAULT 'open' CHECK (account_status IN ('open','closed')),
  closed_date TEXT,
  monthly_fee_cents INTEGER,
  fee_currency TEXT NOT NULL DEFAULT 'USD',
  fee_waiver TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE account_bonus_offers (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  offer_name TEXT,
  offer_url TEXT,
  expected_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  terms_notes TEXT,
  original_terms TEXT,
  expected_payout_date TEXT,
  payment_complete INTEGER NOT NULL DEFAULT 0 CHECK (payment_complete IN (0,1)),
  minimum_open_period TEXT,
  rule_trigger TEXT NOT NULL DEFAULT 'unknown' CHECK (rule_trigger IN ('unknown','opened','first_payment','last_payment','manual')),
  rule_value INTEGER,
  rule_unit TEXT NOT NULL DEFAULT 'days' CHECK (rule_unit IN ('days','months')),
  rule_text TEXT,
  trigger_date TEXT,
  closure_override_date TEXT,
  closure_override_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_bonus_offer_account ON account_bonus_offers(account_id);
CREATE TABLE account_bonus_requirements (
  id INTEGER PRIMARY KEY,
  offer_id INTEGER NOT NULL REFERENCES account_bonus_offers(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  deadline TEXT,
  completed_date TEXT
);
CREATE INDEX idx_bonus_requirement_offer ON account_bonus_requirements(offer_id);
CREATE TABLE account_bonus_payments (
  id INTEGER PRIMARY KEY,
  offer_id INTEGER NOT NULL REFERENCES account_bonus_offers(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  received_date TEXT NOT NULL,
  notes TEXT
);
CREATE INDEX idx_bonus_payment_offer ON account_bonus_payments(offer_id);
