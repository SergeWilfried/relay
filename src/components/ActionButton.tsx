import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}

/** Primary button that locks while its action is running, so a double tap can't submit twice. */
export function ActionButton({ busy, busyLabel, children, className = 'btn', disabled, ...rest }: Props) {
  return (
    <button {...rest} className={className} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? <span className="btn-busy"><span className="spin on-btn" aria-hidden />{busyLabel ?? children}</span> : children}
    </button>
  );
}

export const ErrorNote = ({ children }: { children?: ReactNode }) =>
  children ? <div className="err-note" role="alert">{children}</div> : null;
