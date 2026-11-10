import { HttpError } from './fake-shipping-api.js';

/** BROKEN: retries every error, immediately, a fixed number of times. */
export async function naiveRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Statuses where the same request may succeed later: timeout, rate limit, server errors.
 * Everything else in 4xx (bad input, auth, not found) will fail the same way every time.
 */
export const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export function isRetryable(error: unknown): boolean {
  return error instanceof HttpError && RETRYABLE_STATUSES.has(error.status);
}

export type RetryOptions = {
  /** Total attempts, including the first. */
  maxAttempts: number;
  /** Base delay for exponential backoff, in ms. */
  baseDelayMs: number;
  /** Longest single wait, in ms. A Retry-After longer than this is not waited for. */
  maxDelayMs: number;
  /** Injected so tests don't really wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so tests are deterministic. Returns a number in [0, 1). */
  random?: () => number;
};

export type RetryOutcome<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: unknown; attempts: number; retryable: boolean };

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * FIXED: retries only errors that can succeed later, waits between attempts
 * (Retry-After if the server sent one, otherwise exponential backoff with full jitter),
 * and stops after `maxAttempts`. Never throws: returns what happened.
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<RetryOutcome<T>> {
  const sleep = options.sleep ?? realSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 1; ; attempt++) {
    try {
      return { ok: true, value: await fn(), attempts: attempt };
    } catch (error) {
      const retryable = isRetryable(error);
      if (!retryable || attempt >= options.maxAttempts) {
        return { ok: false, error, attempts: attempt, retryable };
      }

      const retryAfterMs = error instanceof HttpError && error.retryAfterSeconds !== undefined
        ? error.retryAfterSeconds * 1000
        : undefined;
      if (retryAfterMs !== undefined && retryAfterMs > options.maxDelayMs) {
        // The server asked us to wait longer than we are willing to block. Give up now, say so.
        return { ok: false, error, attempts: attempt, retryable };
      }

      // Full jitter: a random wait between 0 and the exponential backoff ceiling.
      const backoffMs = random() * Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1));
      await sleep(retryAfterMs ?? backoffMs);
    }
  }
}
