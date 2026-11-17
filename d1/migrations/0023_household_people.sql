CREATE TABLE household_people (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE accounts ADD COLUMN detailed_type TEXT;
ALTER TABLE accounts ADD COLUMN institution_manual TEXT;
ALTER TABLE accounts ADD COLUMN balance_as_of TEXT;
ALTER TABLE accounts ADD COLUMN notes TEXT;
ALTER TABLE accounts ADD COLUMN login_url TEXT;
ALTER TABLE accounts ADD COLUMN holder_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE accounts ADD COLUMN beneficiary_id TEXT REFERENCES household_people(id);
ALTER TABLE accounts ADD COLUMN responsible_adult_id TEXT REFERENCES household_people(id);
UPDATE accounts SET detailed_type = CASE type
  WHEN 'investment' THEN 'other_investment'
  WHEN 'credit' THEN 'credit_card'
  WHEN 'loan' THEN 'other_loan'
  ELSE CASE subtype WHEN 'checking' THEN 'checking' WHEN 'savings' THEN 'savings' ELSE 'cash_management' END END,
  balance_as_of = substr(updated_at, 1, 10)
WHERE is_manual = 1;
