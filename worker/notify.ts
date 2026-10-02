import { alert, type AlertInput } from './alerts';
import { askClef, clefEnabled, POINTS, TRIAGE_QUESTIONS, triageVerdict } from './clef';
import { loadModes } from './rules';

/**
 * `alert` plus Clef triage (C-05). Critical alerts are sent immediately and never wait for the model: an unknown outcome
 * is already as urgent as it gets. Warning and info alerts are triaged: the verdict is added to the alert, and in enforce mode an
 * INFO alert that Clef is >= 0.95 sure is a false positive is closed with a log line instead of being sent. Any Clef problem
 * falls back to a plain alert, so triage can only ever remove noise, never lose a failure.
 */
export async function notify(env: Env, a: AlertInput): Promise<void> {
	if (a.level === 'critical' || !clefEnabled(env)) return alert(env, a);
	try {
		const mode = (await loadModes(env))['C-05'] ?? POINTS['C-05']!.mode;
		const res = await askClef(env, POINTS['C-05']!, mode, a.title, { level: a.level, title: a.title, details: a.details ?? {} }, TRIAGE_QUESTIONS);
		const t = res ? triageVerdict(res, a.level) : null;
		if (t) {
			const p = Math.round((t.probabilities[t.priority] ?? 0) * 100) / 100;
			if (t.autoClose && mode === 'enforce') {
				console.log(JSON.stringify({ msg: 'alert.auto_closed', by: 'C-05', title: a.title, falsePositive: t.probabilities.false_positive, ...a.details }));
				return;
			}
			return alert(env, { ...a, details: { ...a.details, clef: `${t.priority} (${p})${mode === 'shadow' ? ' [shadow]' : ''}` } });
		}
	} catch (e) { console.error(JSON.stringify({ msg: 'notify.triage_failed', error: e instanceof Error ? e.message : String(e) })); }
	return alert(env, a);
}
