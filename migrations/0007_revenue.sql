-- Revenue: each payout records how its gross FCFA value split into the customer's payout, the platform fee (Relay's revenue)
-- and the PSP fee (passed through), so the admin Revenue tab sums real numbers instead of recomputing from a rate that may change.
-- Always gross = amount_fcfa + platform_fee_fcfa + psp_fee_fcfa. NULL on payouts created before this migration (at the old fee): not counted.
ALTER TABLE payouts ADD COLUMN gross_fcfa INTEGER;
ALTER TABLE payouts ADD COLUMN platform_fee_fcfa INTEGER;
ALTER TABLE payouts ADD COLUMN psp_fee_fcfa INTEGER;
CREATE INDEX IF NOT EXISTS payouts_paid_at ON payouts (status, paid_at);
