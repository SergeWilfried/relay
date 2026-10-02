import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useT } from '../i18n';

export function BackHeader({ title, to, onBack, tight }: { title: ReactNode; to?: string; onBack?: () => void; tight?: boolean }) {
  const nav = useNavigate();
  const { t } = useT();
  return (
    <div className="bh" style={tight ? { marginBottom: 10 } : undefined}>
      <button className="bh-back" aria-label={t('Back')} onClick={onBack ?? (() => (to ? nav(to) : nav(-1)))}>‹</button>
      <h1 className="bh-title" style={{ margin: 0 }}>{title}</h1>
    </div>
  );
}
