import { Bars, Percent } from './Icons';

export const RateTimeline = ({ rate, fee }: { rate: string; fee: string }) => (
  <div className="timeline">
    <div className="tl-row"><Bars />{rate}</div>
    <div className="tl-row"><Percent />{fee}</div>
  </div>
);
