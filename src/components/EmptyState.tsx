import type { ReactNode } from 'react';

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-ico" aria-hidden>{icon ?? '○'}</div>
      <div className="empty-t">{title}</div>
      {body && <div className="empty-b">{body}</div>}
      {action}
    </div>
  );
}
