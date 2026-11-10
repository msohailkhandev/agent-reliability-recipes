import { describe, expect, it } from 'vitest';
import { createBrokenAgent, createFixedAgent } from '../src/agent.js';
import { alwaysInvalidAddress, FakeShippingApi, HttpError, type Outcome } from '../src/fake-shipping-api.js';
import { createQuoteModel } from '../src/mock-model.js';
import { isRetryable, retryWithBackoff, type RetryOptions } from '../src/retry.js';

const prompt = 'How much to ship to 12 Unknown Street?';

/** Retry settings with a fake clock: records waits instead of waiting. */
function fakeClock(overrides: Partial<RetryOptions> = {}) {
  const sleeps: number[] = [];
  const options: RetryOptions = {
    maxAttempts: 3,
    baseDelayMs: 200,
    maxDelayMs: 5_000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    ...overrides,
  };
  return { options, sleeps };
}

/** Returns the given outcomes in order, then repeats the last one. */
const sequence = (...outcomes: Outcome[]) => (n: number) => outcomes[Math.min(n, outcomes.length) - 1]!;

describe('recipe 03: retry storm', () => {
  it('broken agent: a permanent 400 turns into 25 requests (5 model calls x 5 blind retries)', async () => {
    const api = new FakeShippingApi(alwaysInvalidAddress);
    const result = await createBrokenAgent(createQuoteModel(), api).generate({ prompt });
    expect(result.steps).toHaveLength(5);
    expect(api.requests).toBe(25);
  });

  it('fixed agent: a permanent 400 is tried once, and the model is told not to retry', async () => {
    const api = new FakeShippingApi(alwaysInvalidAddress);
    const { options, sleeps } = fakeClock();
    const result = await createFixedAgent(createQuoteModel(), api, options).generate({ prompt });

    expect(api.requests).toBe(1);
    expect(sleeps).toEqual([]);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.toolResults[0]?.output).toMatchObject({ ok: false, retryable: false, status: 400 });
    expect(result.text).toBe('I could not get a quote: the address is invalid. Please check it.');
  });

  it('fixed agent: a short outage (503, 503, then 200) recovers with growing, jittered waits', async () => {
    const api = new FakeShippingApi(
      sequence(
        { status: 503, message: 'Service Unavailable' },
        { status: 503, message: 'Service Unavailable' },
        { status: 200, quoteUsd: 12 },
      ),
    );
    const { options, sleeps } = fakeClock();
    const result = await createFixedAgent(createQuoteModel(), api, options).generate({ prompt });

    expect(api.requests).toBe(3);
    // random() = 0.5 → 0.5 x 200ms, then 0.5 x 400ms
    expect(sleeps).toEqual([100, 200]);
    expect(result.text).toBe('Shipping costs $12.');
  });

  it('fixed agent: honours Retry-After on a 429', async () => {
    const api = new FakeShippingApi(
      sequence({ status: 429, message: 'Too Many Requests', retryAfterSeconds: 2 }, { status: 200, quoteUsd: 12 }),
    );
    const { options, sleeps } = fakeClock();
    await createFixedAgent(createQuoteModel(), api, options).generate({ prompt });
    expect(api.requests).toBe(2);
    expect(sleeps).toEqual([2_000]);
  });

  it('fixed agent: does not block for a Retry-After longer than maxDelayMs, and reports it', async () => {
    const api = new FakeShippingApi(() => ({ status: 429, message: 'Too Many Requests', retryAfterSeconds: 60 }));
    const { options, sleeps } = fakeClock();
    const result = await createFixedAgent(createQuoteModel(), api, options).generate({ prompt });

    expect(api.requests).toBe(1);
    expect(sleeps).toEqual([]);
    expect(result.steps[0]?.toolResults[0]?.output).toMatchObject({ ok: false, retryable: true, retryAfterSeconds: 60 });
    expect(result.text).toBe('The shipping service is busy right now. Please try again later.');
  });

  it('fixed agent: a long outage stops after maxAttempts', async () => {
    const api = new FakeShippingApi(() => ({ status: 503, message: 'Service Unavailable' }));
    const { options, sleeps } = fakeClock();
    const result = await createFixedAgent(createQuoteModel(), api, options).generate({ prompt });

    expect(api.requests).toBe(3);
    expect(sleeps).toEqual([100, 200]);
    expect(result.text).toBe('The shipping service is busy right now. Please try again later.');
  });

  it('backoff never waits longer than maxDelayMs', async () => {
    const { options, sleeps } = fakeClock({ maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 1_500 });
    const outcome = await retryWithBackoff(async () => {
      throw new HttpError(503, 'Service Unavailable');
    }, options);
    expect(outcome).toMatchObject({ ok: false, attempts: 4, retryable: true });
    // 0.5 x min(1500, 1000), 0.5 x min(1500, 2000), 0.5 x min(1500, 4000)
    expect(sleeps).toEqual([500, 750, 750]);
  });

  it('only timeouts, rate limits and server errors are retryable', () => {
    for (const status of [408, 429, 500, 502, 503, 504]) expect(isRetryable(new HttpError(status, 'x'))).toBe(true);
    for (const status of [400, 401, 403, 404, 422]) expect(isRetryable(new HttpError(status, 'x'))).toBe(false);
    expect(isRetryable(new Error('something else'))).toBe(false);
  });
});
