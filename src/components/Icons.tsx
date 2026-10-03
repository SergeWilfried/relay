import type { SVGProps } from 'react';
const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M3.5 5.25 7 8.75l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const Bars = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden><path d="M2 11V7M6.5 11V4M11 11V2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
);
export const Percent = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden><path d="M10.5 2.5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="3.5" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.3" /><circle cx="9.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.3" /></svg>
);
const Nav = (p: SVGProps<SVGSVGElement>) => <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden {...s} {...p} />;
export const TradeIcon = () => <Nav><path d="M4 7h12l-3-3M16 13H4l3 3" /></Nav>;
export const PoolIcon = () => <Nav><path d="M10 3c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z" /></Nav>;
export const ActivityIcon = () => <Nav><path d="M3 10h3l2-5 4 10 2-5h3" /></Nav>;
export const AccountIcon = () => <Nav><circle cx="10" cy="7" r="3" /><path d="M4 17c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5" /></Nav>;
