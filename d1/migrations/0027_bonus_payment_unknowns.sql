-- Preserve receipts even when the amount or date is not yet known; never require an invented date.
ALTER TABLE account_bonus_payments RENAME TO account_bonus_payments_dated;
CREATE TABLE account_bonus_payments (
  id INTEGER PRIMARY KEY,
  offer_id INTEGER NOT NULL REFERENCES account_bonus_offers(id) ON DELETE CASCADE,
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents > 0),
  received_date TEXT,
  notes TEXT,
  CHECK (amount_cents IS NOT NULL OR received_date IS NOT NULL)
);
INSERT INTO account_bonus_payments (id,offer_id,amount_cents,received_date,notes)
SELECT id,offer_id,amount_cents,received_date,notes FROM account_bonus_payments_dated;
DROP TABLE account_bonus_payments_dated;
CREATE INDEX idx_bonus_payment_offer ON account_bonus_payments(offer_id);
