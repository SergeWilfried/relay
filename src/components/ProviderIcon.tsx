import type { Provider } from '../lib/data';

/** Provider logo in a small rounded tile (their logos are all different shapes), or the lettered circle if there's none. */
export function ProviderIcon({ p, size = 26 }: { p: Provider; size?: number }) {
  if (p.logo) return <img src={p.logo} alt="" width={size} height={size} className="prov-img" style={{ width: size, height: size }} draggable={false} />;
  return <div className="prov-dot" style={{ background: p.color, color: p.fg, width: size, height: size }}>{p.char}</div>;
}
