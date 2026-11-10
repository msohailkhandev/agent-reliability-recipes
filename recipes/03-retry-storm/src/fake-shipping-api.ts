/** An HTTP error with the status code and, when sent, the Retry-After value in seconds. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(`HTTP ${status}: ${message}`);
    this.name = 'HttpError';
  }
}

export type Outcome =
  | { status: 200; quoteUsd: number }
  | { status: number; message: string; retryAfterSeconds?: number };

/**
 * A fake shipping-quote API, so the recipe runs offline.
 * `respond(n)` decides what the n-th request (starting at 1) returns.
 */
export class FakeShippingApi {
  requests = 0;

  constructor(private readonly respond: (requestNumber: number) => Outcome) {}

  async getQuote(address: string): Promise<{ address: string; quoteUsd: number }> {
    this.requests += 1;
    const outcome = this.respond(this.requests);
    if (outcome.status === 200 && 'quoteUsd' in outcome) return { address, quoteUsd: outcome.quoteUsd };
    const failure = outcome as { status: number; message: string; retryAfterSeconds?: number };
    throw new HttpError(failure.status, failure.message, failure.retryAfterSeconds);
  }
}

/** Every request fails with 400: the address is invalid. Retrying can never help. */
export const alwaysInvalidAddress = (): Outcome => ({ status: 400, message: 'Invalid destination address' });
