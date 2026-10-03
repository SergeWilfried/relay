import { useLayoutEffect, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PrivyProvider, useCreateWallet, usePrivy, useSendTransaction, useSigners, useUser } from '@privy-io/react-auth';
import { useCreateWallet as useCreateSolanaWallet, useSignAndSendTransaction, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { buildSolTransfer, signatureToString } from '../lib/solanaTransfer';
import { planSend } from '../lib/send';
import { fetchSwapStatus } from '../lib/swapLive';
import { setTokenGetter } from '../lib/http';
import { tr } from '../i18n';
import { useTheme } from '../state/theme';
import { AuthCtx, type AuthState, type Network } from './AuthContext';

interface LinkedWallet { type: string; address?: string; chainType?: string; walletClientType?: string; /** Relay's signer was added to this wallet (swaps) */ delegated?: boolean }
type Chain = 'Ethereum' | 'Solana';

const errMessage = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Unknown error');
const isEmbedded = (a: LinkedWallet) => !!a.walletClientType?.startsWith('privy');

function Bridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { refreshUser } = useUser();
  const { createWallet: createEthereum } = useCreateWallet();
  const { createWallet: createSolana } = useCreateSolanaWallet();
  const { sendTransaction } = useSendTransaction();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { addSigners } = useSigners();
  const { wallets: solWallets } = useSolanaWallets();

  const linked = useMemo(() => ((user?.linkedAccounts ?? []) as LinkedWallet[]).filter((a) => a.type === 'wallet' && a.address), [user]);

  const wallets = useMemo(() => {
    const out: Partial<Record<Network, string>> = {};
    // embedded (Privy) wallets first, then anything the user linked themselves
    for (const a of [...linked.filter(isEmbedded), ...linked.filter((a) => !isEmbedded(a))]) {
      const net: Network | null = a.chainType === 'ethereum' ? 'Ethereum' : a.chainType === 'solana' ? 'Solana' : null;
      if (net && !out[net]) out[net] = a.address;
    }
    return out;
  }, [linked]);

  const hasEmbedded = (chain: string) => linked.some((a) => isEmbedded(a) && a.chainType === chain);
  const needEth = !hasEmbedded('ethereum');
  const needSol = !hasEmbedded('solana');

  // Provision embedded wallets explicitly after sign-in. Privy's createOnLogin setting doesn't fire for
  // headless (custom UI) logins, so we create whatever is missing and surface any error.
  const [creating, setCreating] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Chain, string>>>({});
  const attempted = useRef(new Set<string>());
  const busy = useRef(false);

  const provision = useCallback(async (force = false) => {
    if (!ready || !authenticated || !user || busy.current) return;
    const todo: [Chain, () => Promise<unknown>][] = [];
    const key = (c: Chain) => `${user.id}:${c}`;
    if (needEth && (force || !attempted.current.has(key('Ethereum')))) todo.push(['Ethereum', () => createEthereum()]);
    if (needSol && (force || !attempted.current.has(key('Solana')))) todo.push(['Solana', () => createSolana()]);
    if (todo.length === 0) return;
    busy.current = true; setCreating(true);
    const next: Partial<Record<Chain, string>> = {};
    for (const [chain, create] of todo) {
      attempted.current.add(key(chain));
      try { await create(); } catch (e) { next[chain] = errMessage(e); }
    }
    try { await refreshUser(); } catch { /* user object refreshes on its own shortly after */ }
    setErrors(next);
    busy.current = false; setCreating(false);
  }, [ready, authenticated, user, needEth, needSol, createEthereum, createSolana, refreshUser]);

  useEffect(() => { void provision(); }, [provision]);
  // forget per-user attempts on sign-out so the next login provisions again
  useEffect(() => { if (!authenticated) { attempted.current.clear(); setErrors({}); } }, [authenticated]);

  // A layout effect, not useEffect: React runs a child's effects before its parent's, so with useEffect the app's first requests
  // (limits, KYC status, quotes) left before this ran and got a 401. Layout effects all run before any passive effect.
  useLayoutEffect(() => { setTokenGetter(authenticated ? getAccessToken : null); }, [authenticated, getAccessToken]);

  const missing = authenticated && (needEth || needSol);
  const hasErrors = Object.keys(errors).length > 0;
  const value: AuthState = {
    mode: 'privy', ready, authenticated,
    userId: user?.id ?? null,
    email: user?.email?.address ?? null,
    wallets,
    walletStatus: creating || (missing && !hasErrors) ? 'creating' : hasErrors && missing ? 'error' : 'ready',
    walletErrors: errors,
    retryWallets: () => { void provision(true); },
    canSend: (sym) => (sym === 'SOL' ? !!wallets.Solana : sym === 'ETH' || sym === 'USDT' || sym === 'USDC' ? !!wallets.Ethereum : false),
    sendAsset: async (sym, to, amount) => {
      const plan = planSend(sym, to, amount);
      if (!plan) throw new Error(tr("{sym} can't be sent from your Relay wallet. Use the address above from another wallet.", { sym }));
      if (plan.kind === 'evm') {
        if (!wallets.Ethereum) throw new Error(tr('Your Ethereum wallet is not ready yet.'));
        // Privy shows its own confirmation sheet for the embedded wallet before signing
        const { hash } = await sendTransaction({ to: plan.to, value: plan.value, data: plan.data, chainId: plan.chainId }, { address: wallets.Ethereum });
        return hash;
      }
      const from = wallets.Solana;
      const wallet = solWallets.find((w) => w.address === from);
      if (!from || !wallet) throw new Error(tr('Your Solana wallet is not ready yet.'));
      const transaction = await buildSolTransfer(from, plan.to, plan.lamports);
      const { signature } = await signAndSendTransaction({ transaction, wallet, chain: 'solana:mainnet' });
      return signatureToString(signature);
    },
    // swaps: the customer consents once per wallet to let Relay's server (a signer) ask Privy to run swaps from it
    swapReady: (net) => linked.some((a) => isEmbedded(a) && a.chainType === (net === 'Solana' ? 'solana' : 'ethereum') && !!a.delegated),
    enableSwaps: async (net) => {
      const address = wallets[net];
      if (!address) throw new Error(tr('Your {net} wallet is not ready yet.', { net }));
      const info = await fetchSwapStatus();
      if (!info.configured || !info.signerId) throw new Error(tr('Swaps are not available yet'));
      const policy = net === 'Solana' ? info.policyIds.solana : info.policyIds.ethereum;
      await addSigners({ address, signers: [{ signerId: info.signerId, policyIds: policy ? [policy] : [] }] });
      try { await refreshUser(); } catch { /* the user object refreshes on its own shortly after */ }
    },
    openLogin: () => login(),
    logout,
    getAccessToken,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export default function PrivyAuth({ appId, children }: { appId: string; children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: { theme, accentColor: '#7B3FF2', logo: `${location.origin}/icon.svg` },
        // Login methods (email, passkey, SMS/WhatsApp, social, wallets) are managed in the Privy dashboard.
        // Wallets are created by the app right after sign-in (see Bridge), so auto-create is off.
        embeddedWallets: { ethereum: { createOnLogin: 'off' }, solana: { createOnLogin: 'off' } },
      }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}
