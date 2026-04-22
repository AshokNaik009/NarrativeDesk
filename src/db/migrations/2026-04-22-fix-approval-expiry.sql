-- Fix broken approval expirations
-- Set expires_at to NOW() + 15 minutes for:
-- 1. Any pending approval with NULL expires_at
-- 2. Any pending approval with expires_at in the past (created before fix)

UPDATE pending_approvals
SET expires_at = NOW() + INTERVAL '15 minutes'
WHERE status = 'pending' AND (
  expires_at IS NULL
  OR expires_at < NOW()
);

-- For already expired/resolved approvals, ensure they have a valid timestamp
UPDATE pending_approvals
SET expires_at = resolved_at + INTERVAL '1 minute'
WHERE expires_at IS NULL AND resolved_at IS NOT NULL;

-- Fallback: any row still with NULL expires_at gets NOW() as fallback
UPDATE pending_approvals
SET expires_at = NOW()
WHERE expires_at IS NULL;
