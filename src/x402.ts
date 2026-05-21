/**
 * x402 payment integration (USDC on Base or Solana).
 *
 * The osModa API gates `POST /api/v1/spawn/:planId` with x402: an unpaid request
 * gets `402 Payment Required` with `{ x402Version, error, accepts: [...] }`, and
 * a paid retry carries an `X-PAYMENT` header. The canonical client is
 * **`@x402/fetch`**, which wraps `fetch` to do the 402→pay→retry dance
 * transparently.
 *
 * Two ways to enable auto-pay (both correct — no custom payment code here):
 *
 *   1. Pass a payment-wrapped fetch as the client's `fetch`:
 *        import { wrapFetchWithPayment } from "@x402/fetch";
 *        const payFetch = wrapFetchWithPayment(fetch, x402Client);
 *        new OsmodaClient({ fetch: payFetch });
 *
 *   2. Pass a `wallet` (an x402 client/config) and let the SDK wrap fetch for
 *      you (requires `@x402/fetch` installed):
 *        new OsmodaClient({ wallet: x402Client });
 *
 * Without either, `spawn()` returns the invoice via `OsmodaPaymentRequired`.
 *
 * `@x402/fetch` is an OPTIONAL peer dependency — only needed for option 2.
 */

export type FetchLike = typeof fetch;

/**
 * Build a payment-enabled fetch from a base fetch + an x402 client/config, using
 * the real `@x402/fetch` API (`wrapFetchWithPayment`). Throws a clear error if
 * `@x402/fetch` isn't installed.
 */
export async function makePaymentFetch(baseFetch: FetchLike, wallet: unknown): Promise<FetchLike> {
  let mod: any;
  try {
    mod = await import(/* @vite-ignore */ "@x402/fetch" as string);
  } catch {
    throw new Error(
      "Auto-pay needs the optional '@x402/fetch' package. Either install it " +
        "(`npm install @x402/fetch`) and pass a `wallet`, or pre-wrap your own fetch with " +
        "wrapFetchWithPayment(fetch, client) and pass it as `fetch`. Otherwise omit `wallet` " +
        "and pay the invoice from OsmodaPaymentRequired.paymentRequirements.",
    );
  }
  const wrap = mod.wrapFetchWithPayment || mod.default?.wrapFetchWithPayment;
  if (typeof wrap !== "function") {
    throw new Error("Installed @x402/fetch does not export wrapFetchWithPayment(); upgrade the package.");
  }
  return wrap(baseFetch, wallet) as FetchLike;
}
