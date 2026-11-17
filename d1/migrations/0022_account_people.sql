-- Household owner remains the existing grouping/credential identity.
ALTER TABLE accounts ADD COLUMN holder_name TEXT;
ALTER TABLE accounts ADD COLUMN beneficiary_name TEXT;
ALTER TABLE accounts ADD COLUMN responsible_adult_name TEXT;
