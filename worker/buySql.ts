import { BUY_COUNTED, COUNTED } from './rules.ts';

/**
 * Creates a buy order only if it still fits the user's daily and monthly limits, counting sells AND buys (so the limit is really per user),
 * in one statement: two requests racing can't both slip under a limit. Import-free apart from the SQL fragments, so test/buySql.test.ts
 * can run it against a real SQLite.
 *  ?1 user, ?2 now, ?3 start of day, ?4 start of month, ?5 fcfa, ?6 daily limit, ?7 monthly limit, then the row values (?8 to ?23).
 */
export const INSERT_BUY_SQL = `INSERT INTO buy_orders (id, user_id, asset, network, fcfa, platform_fee_fcfa, psp_fee_fcfa, network_fee_fcfa, amount_units, destination,
	operator, provider_code, phone, status, auth_type, hold_rules, hold_message, hold_until, expires_at, created_at, updated_at)
	SELECT ?8, ?1, ?9, ?10, ?5, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, 'created', ?19, ?20, ?21, ?22, ?23, ?2, ?2
	WHERE (SELECT COALESCE(SUM(o.amount_fcfa), 0) FROM orders o WHERE ${COUNTED} AND o.created_at >= ?3)
	    + (SELECT COALESCE(SUM(b.fcfa), 0) FROM buy_orders b WHERE ${BUY_COUNTED} AND b.created_at >= ?3) + ?5 <= ?6
	  AND (SELECT COALESCE(SUM(o.amount_fcfa), 0) FROM orders o WHERE ${COUNTED} AND o.created_at >= ?4)
	    + (SELECT COALESCE(SUM(b.fcfa), 0) FROM buy_orders b WHERE ${BUY_COUNTED} AND b.created_at >= ?4) + ?5 <= ?7`;
