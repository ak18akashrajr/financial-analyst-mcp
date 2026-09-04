-- Goal-Based Investing: let a symbol allocation "track max" so it always claims 100% of the
-- current holding (minus whatever other goals separately reserve on the same symbol), instead of
-- freezing at whatever unit count "Use max" captured at add-time. Without this, buying more units
-- of a symbol already earmarked to a goal left that goal's progress stale until the allocation was
-- manually deleted and re-added.
ALTER TABLE public.goal_allocations ADD COLUMN IF NOT EXISTS track_max boolean NOT NULL DEFAULT false;

-- One-time backfill: a symbol allocation whose stored quantity already equals the full current
-- holding for that symbol was presumably added via "Use max" — flip it to auto-track so it starts
-- reflecting future buys immediately, matching what "Use max" means going forward.
WITH holding_qty AS (
  SELECT
    symbol,
    COALESCE(SUM(CASE WHEN type = 'BUY' THEN quantity ELSE -quantity END), 0) AS total_qty
  FROM public.transactions
  GROUP BY symbol
)
UPDATE public.goal_allocations ga
SET track_max = true
FROM holding_qty hq
WHERE ga.source_type = 'symbol'
  AND ga.symbol = hq.symbol
  AND ga.quantity IS NOT NULL
  AND hq.total_qty > 0
  AND ROUND(ga.quantity::numeric, 6) = ROUND(hq.total_qty::numeric, 6);
