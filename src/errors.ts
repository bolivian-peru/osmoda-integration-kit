/**
 * Typed errors mapped from the API's uniform error envelope:
 *   { code, message, detail?, request_id, error }
 * Every response also carries an `X-Request-Id` header.
 */

export interface ErrorEnvelope {
  code?: string;
  message?: string;
  detail?: unknown;
  request_id?: string;
  /** Legacy alias for `code`. */
  error?: string;
}

export class OsmodaError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: unknown;
  readonly requestId?: string;
  /** Present on 429 responses (seconds). */
  readonly retryAfter?: number;

  constructor(args: {
    code: string;
    message: string;
    status: number;
    detail?: unknown;
    requestId?: string;
    retryAfter?: number;
  }) {
    super(args.message);
    this.name = "OsmodaError";
    this.code = args.code;
    this.status = args.status;
    this.detail = args.detail;
    this.requestId = args.requestId;
    this.retryAfter = args.retryAfter;
  }
}

/**
 * Thrown by spawn() when the request is x402 payment-gated (HTTP 402) and no
 * wallet was supplied to pay it automatically. `paymentRequirements` is the
 * raw x402 invoice from the response so you can pay it your own way and retry.
 */
export class OsmodaPaymentRequired extends OsmodaError {
  readonly paymentRequirements: unknown;
  constructor(args: { message: string; requestId?: string; paymentRequirements: unknown }) {
    super({ code: "payment_required", message: args.message, status: 402, requestId: args.requestId });
    this.name = "OsmodaPaymentRequired";
    this.paymentRequirements = args.paymentRequirements;
  }
}

/** Build an OsmodaError from a fetch Response + parsed body. */
export async function errorFromResponse(res: Response): Promise<OsmodaError> {
  const requestId = res.headers.get("x-request-id") || undefined;
  let body: ErrorEnvelope = {};
  try {
    body = (await res.json()) as ErrorEnvelope;
  } catch {
    /* non-JSON error body */
  }
  const retryAfterRaw = res.headers.get("retry-after");
  return new OsmodaError({
    code: body.code || body.error || `http_${res.status}`,
    message: body.message || `Request failed with HTTP ${res.status}`,
    status: res.status,
    detail: body.detail,
    requestId: body.request_id || requestId,
    retryAfter: retryAfterRaw ? parseInt(retryAfterRaw, 10) || undefined : undefined,
  });
}
