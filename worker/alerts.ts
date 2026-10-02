/**
 * Operational alerts for things a person must look at: a sweep or payout that failed or has an unknown outcome,
 * a payout put on hold. Always written to the Worker log as an `alert` line; also POSTed to ALERT_WEBHOOK_URL when set.
 * The body carries both `text` (Slack-compatible) and `content` (Discord-compatible) plus structured fields, so most
 * incoming-webhook URLs work as they are. No customer data goes out: order ids, assets, amounts and rule ids only.
 * An alert can never break the operation that raised it: failures are logged and swallowed.
 */
export type AlertLevel = 'critical' | 'warning' | 'info';
export interface AlertInput { level: AlertLevel; title: string; details?: Record<string, string | number | null | undefined> }

const ICON: Record<AlertLevel, string> = { critical: '🔴', warning: '🟠', info: 'ℹ️' };

export function formatAlert(a: AlertInput): string {
	const lines = Object.entries(a.details ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${v}`);
	return [`${ICON[a.level]} Relay: ${a.title}`, ...lines].join('\n');
}

export async function alert(env: Env, a: AlertInput): Promise<void> {
	const text = formatAlert(a);
	console.error(JSON.stringify({ msg: 'alert', level: a.level, title: a.title, ...a.details }));
	const url = env.ALERT_WEBHOOK_URL;
	if (!url) return;
	try {
		const res = await fetch(url, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text, content: text, level: a.level, title: a.title, details: a.details ?? {} }),
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) console.error(JSON.stringify({ msg: 'alert.webhook_rejected', status: res.status }));
	} catch (e) { console.error(JSON.stringify({ msg: 'alert.webhook_failed', error: e instanceof Error ? e.message : String(e) })); }
}
