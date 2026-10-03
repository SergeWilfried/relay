/**
 * Queues a sweep for every order whose funds belong in the treasury. Kept in its own import-free file so test/sweepSql.test.ts can run it
 * against a real SQLite (a NULL in a NOT (... AND ...) once silently queued nothing, and only the real SQL can catch that).
 *  ?1 = now (ms), ?2 = 1 when LIVE (real deposit wallets only) else 0 (sandbox orders only)
 * An underpaid deposit is forwarded only once a refund of it is APPROVED: the treasury is where the refund is sent from.
 * Funds that came from a denylisted address (hold A-01, not released) are not forwarded.
 */
export const ENQUEUE_SWEEPS_SQL = `INSERT OR IGNORE INTO sweeps (order_id, wallet_id, chain, asset, amount_units, status, created_at, updated_at)
	SELECT o.id, o.deposit_wallet_id, CASE o.network WHEN 'Solana' THEN 'solana' ELSE 'ethereum' END, o.asset, o.deposit_amount_units, 'pending', ?1, ?1
	FROM orders o
	WHERE o.tab = 'sell' AND o.deposit_amount_units IS NOT NULL
	  AND (o.status = 'processing' OR (o.status = 'underpaid' AND EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id AND r.status IN ('approved', 'sent'))))
	  AND (?2 = 0 OR (o.deposit_live = 1 AND o.deposit_wallet_id IS NOT NULL))
	  AND NOT (COALESCE(o.hold_rules, '') LIKE '%"A-01"%' AND o.hold_released_at IS NULL)`;
