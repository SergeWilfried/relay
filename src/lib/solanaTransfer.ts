import { getBase58Decoder, address, appendTransactionMessageInstruction, compileTransaction, createNoopSigner, createSolanaRpc, createTransactionMessage, getTransactionEncoder, lamports, pipe, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

const SOL_RPC = (import.meta.env.VITE_SOL_RPC_URL as string | undefined) || 'https://solana-rpc.publicnode.com';

/** Unsigned SOL transfer, serialised for Privy to sign and send. */
export async function buildSolTransfer(from: string, to: string, amountLamports: bigint): Promise<Uint8Array> {
  const rpc = createSolanaRpc(SOL_RPC);
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const payer = createNoopSigner(address(from)); // Privy signs; this only names the fee payer / source
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstruction(getTransferSolInstruction({ source: payer, destination: address(to), amount: lamports(amountLamports) }), m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

export const signatureToString = (sig: Uint8Array) => getBase58Decoder().decode(sig);
