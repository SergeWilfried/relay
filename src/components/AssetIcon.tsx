interface Props { char: string; color: string; logo?: string; size?: number; alt?: string }

/** Token logo when we have one, otherwise the lettered circle. */
export function AssetIcon({ char, color, logo, size = 30 }: Props) {
  if (logo) {
    return <img src={logo} alt="" width={size} height={size} className="chip-img" style={{ width: size, height: size }} draggable={false} />;
  }
  return <div className="chip-dot" style={{ background: color, width: size, height: size, fontSize: size * 0.4 }}>{char}</div>;
}
