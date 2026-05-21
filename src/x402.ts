/**
 * x402 payment helper (USDC on Base or Solana).
 *
 * The `@x402/*` packages are OPTIONAL peer dependencies — the SDK works fully
 * for free endpoints without them, and spawn() will simply throw
 * OsmodaPaymentRequired (with the invoice) when no wallet/x402 support is
 * present. Install them only if you want the SDK to pay spawn invoices for you:
 *
 *   npm install @x402/core @x402/evm      # Base (EVM)
 *   npm install @x402/core @x402/solana   # Solana
 *
 * This module dynamically imports @x402/core so the dependency stays optional.
 */

export interface PaymentResult {
  /** Header value to send on the retry (e.g. `X-PAYMENT`). */
  header: Record<string, string>;
}

/**
 * Given a wallet/signer and the x402 paymentRequirements from a 402 response,
 * produce the payment header to retry the request with. Throws a clear error if
 * @x402/core isn't installed.
 */
export async function settleX402(wallet: unknown, paymentRequirements: unknown): Promise<PaymentResult> {
  let x402core: any;
  try {
    // Optional dependency — only loaded if the integrator installed it.
    x402core = await import(/* @vite-ignore */ "@x402/core" as string);
  } catch {
    throw new Error(
      "x402 payment requires the optional '@x402/core' package (plus '@x402/evm' or " +
        "'@x402/solana'). Install it, or omit `wallet` and pay the invoice yourself " +
        "from OsmodaPaymentRequired.paymentRequirements.",
    );
  }
  if (typeof x402core.createPayment !== "function") {
    throw new Error("Installed @x402/core does not expose createPayment(); upgrade the package.");
  }
  // The exact signature is intentionally permissive — @x402/core owns the wallet
  // ⇄ chain specifics. We pass the wallet + requirements through.
  const payment = await x402core.createPayment({ wallet, requirements: paymentRequirements });
  const headerName: string = payment.headerName || "X-PAYMENT";
  const headerValue: string = payment.header || payment.value || payment;
  return { header: { [headerName]: headerValue } };
}
