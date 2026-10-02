export function FieldRow({ label, value, hint, onClick }: { label: string; value: string; hint: string; onClick?: () => void }) {
  const inner = (
    <>
      <div><div className="field-l">{label}</div><div className="field-v">{value}</div></div>
      <div className="field-h">{hint}{onClick ? ' ›' : ''}</div>
    </>
  );
  return onClick
    ? <button type="button" className="field" style={{ width: '100%' }} onClick={onClick}>{inner}</button>
    : <div className="field">{inner}</div>;
}
