import { ASSETS, ETH, type Asset, type Provider, type Tab } from './data';
import { fmtCrypto, fmtInt, fmtRate, localizePct } from './format';
import { tr } from '../i18n';
import { feesOn, floor100, TOTAL_FEE } from './fees';

export const shortAddr = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const pct = (r: number) => localizePct(`${r * 100}%`);
/** One fee line for customers: the 2.5% platform fee and the 2.5% provider fee are shown as a single 5% (the split is admin-only). */
const feeRow = (gross: number): [string, string] => [tr('Fee'), `${pct(TOTAL_FEE)} · ${fmtInt(feesOn(gross).total)} FCFA`];

export interface QuoteInput {
  tab: Tab;
  amount: number;
  /** swap: asset sent. buy/sell: the crypto asset. */
  from: Asset;
  /** swap: asset received. */
  to: Asset;
  /** wallet balance of the paid asset; null = unknown (don't block), undefined = use the asset's mock balance */
  balance?: number | null;
}

export interface Quote {
  fromAmt: string;
  toAmt: string;
  fromSub: string;
  toSub: string;
  rate: string;
  fee: string;
  rows: [string, string][];
  summaryFrom: string;
  summaryTo: string;
  insufficient: boolean;
  /** FCFA gross used in order steps */
  fcfaGross: number;
  toValue: number;
}

/**
 * Local quote model. Swap for the quote API (debounced from the UI) —
 * keep the returned shape and the screens won't change.
 */
export function getQuote(input: QuoteInput, provider: Provider | null, wallet: string, priceMult = 1): Quote {
  const { tab, amount, to } = input;
  const bal = input.balance === undefined ? input.from.balance : input.balance;
  const balText = bal === null ? '—' : fmtCrypto(bal, 2, input.from.dec);
  // priceMult simulates the rate moving between quotes (used by the quote refresh)
  const from: Asset = priceMult === 1 ? input.from : { ...input.from, fcfa: input.from.fcfa * priceMult };
  const crypto = from;
  if (tab === 'swap') {
    const gross = amount * from.fcfa;
    const fee = feesOn(gross).total;
    const recv = (amount * from.fcfa) / to.fcfa;
    const rate = `1 ${from.sym} = ${fmtRate(from.fcfa / to.fcfa)} ${to.sym} · ${fmtInt(from.fcfa)} FCFA`;
    return {
      fromAmt: fmtCrypto(amount, 2, 8), toAmt: fmtRate(recv),
      fromSub: `≈ ${fmtInt(Math.round(gross / 100) * 100)} FCFA · ${tr('Balance')} ${balText} ${from.sym}`,
      toSub: `≈ ${fmtInt(floor100(gross - fee))} FCFA ${tr('after fees')}`,
      rate, fee: tr('Fee: {rate} · Slippage 0.5%', { rate: pct(TOTAL_FEE) }),
      rows: [
        [tr('Rate'), `1 ${from.sym} = ${fmtRate(from.fcfa / to.fcfa)} ${to.sym}`],
        [tr('Network fee'), `${fmtInt(1240)} FCFA`],
        feeRow(gross),
        [tr('Est. arrival'), tr('~45 seconds')],
        [tr('You receive'), `${fmtRate(recv)} ${to.sym}`],
      ],
      summaryFrom: `${fmtCrypto(amount, 2, 8)} ${from.sym}`, summaryTo: `${fmtRate(recv)} ${to.sym}`,
      insufficient: bal !== null && amount > bal, fcfaGross: gross, toValue: recv,
    };
  }
  if (tab === 'buy') {
    const fee = feesOn(amount).total;
    const netFee = 710;
    const net = Math.max(0, amount - fee - netFee);
    const k = 10 ** crypto.dec;
    const recv = Math.floor((net / crypto.fcfa) * k) / k;
    const rate = `1 ${crypto.sym} = ${fmtInt(crypto.fcfa)} FCFA`;
    const p = provider;
    return {
      fromAmt: fmtInt(amount), toAmt: fmtCrypto(recv, crypto.dec, crypto.dec),
      fromSub: p ? `${p.name} ${p.number} · ${tr('instant')}` : tr('Pay from mobile money'),
      toSub: `≈ ${fmtInt(floor100(net))} FCFA ${tr('after fees')}`,
      rate, fee: tr('Fee: {rate} · {amount} FCFA', { rate: pct(TOTAL_FEE), amount: fmtInt(fee) }),
      rows: [
        [tr('Rate'), rate],
        feeRow(amount),
        [tr('Network fee'), `${fmtInt(netFee)} FCFA`],
        [tr('Receiving wallet'), shortAddr(wallet)],
        [tr('Est. arrival'), tr('Instant')],
        [tr('You receive'), `${fmtCrypto(recv, crypto.dec, crypto.dec)} ${crypto.sym}`],
      ],
      summaryFrom: `${fmtInt(amount)} FCFA`, summaryTo: `${fmtCrypto(recv, crypto.dec, crypto.dec)} ${crypto.sym}`,
      insufficient: false, fcfaGross: amount, toValue: recv,
    };
  }
  // sell
  const gross = amount * crypto.fcfa;
  const fee = feesOn(gross).total;
  const get = floor100(gross - fee);
  const rate = `1 ${crypto.sym} = ${fmtInt(crypto.fcfa)} FCFA`;
  const p = provider;
  return {
    fromAmt: fmtCrypto(amount, 2, 8), toAmt: fmtInt(get),
    fromSub: `${tr('Balance')} ${balText} ${crypto.sym} · Max`,
    toSub: tr('Arrives in 1–2 minutes'),
    rate, fee: tr('Fee: {rate} · {amount} FCFA', { rate: pct(TOTAL_FEE), amount: fmtInt(fee) }),
    rows: [
      [tr('Rate'), rate],
      feeRow(gross),
      [tr('Payout account'), p ? `${p.name} ${p.number}` : '—'],
      [tr('Est. arrival'), tr('1–2 minutes')],
      [tr('You get'), `${fmtInt(get)} FCFA`],
    ],
    summaryFrom: `${fmtCrypto(amount, 2, 8)} ${crypto.sym}`, summaryTo: `${fmtInt(get)} FCFA`,
    insufficient: bal !== null && amount > bal, fcfaGross: gross, toValue: get,
  };
}

export const defaultAmount = (tab: Tab) => (tab === 'buy' ? '1500000' : '1.5');
export const defaultAssets = (): { from: Asset; to: Asset } => ({ from: ETH, to: ASSETS[1] });
