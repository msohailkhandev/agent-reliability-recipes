import { isStepCount, tool, ToolLoopAgent, type LanguageModel } from 'ai';
import { z } from 'zod';
import { HttpError, type FakeShippingApi } from './fake-shipping-api.js';
import { naiveRetry, retryWithBackoff, type RetryOptions } from './retry.js';

const inputSchema = z.object({ address: z.string() });
const instructions = 'Get a shipping quote for the address the user gives you.';

/**
 * BROKEN: the tool retries every error 5 times with no wait, then throws.
 * The model sees the error and calls the tool again — so every model retry
 * multiplies into 5 more requests to an API that will never say yes.
 */
export function createBrokenAgent(model: LanguageModel, api: FakeShippingApi) {
  return new ToolLoopAgent({
    model,
    instructions,
    stopWhen: isStepCount(5),
    tools: {
      getShippingQuote: tool({
        description: 'Get a shipping quote in USD for a destination address.',
        inputSchema,
        execute: async ({ address }) => naiveRetry(() => api.getQuote(address)),
      }),
    },
  });
}

/**
 * FIXED: the tool retries only what can succeed later, waits between attempts,
 * and returns a clear result instead of throwing — including whether trying
 * again could help. That gives the model a reason to stop.
 */
export function createFixedAgent(model: LanguageModel, api: FakeShippingApi, retry: RetryOptions) {
  return new ToolLoopAgent({
    model,
    instructions,
    stopWhen: isStepCount(5),
    tools: {
      getShippingQuote: tool({
        description:
          'Get a shipping quote in USD for a destination address. ' +
          'If the result has retryable: false, do not call this tool again with the same input; tell the user why.',
        inputSchema,
        execute: async ({ address }) => {
          const outcome = await retryWithBackoff(() => api.getQuote(address), retry);
          if (outcome.ok) return { ok: true as const, ...outcome.value };
          const error = outcome.error;
          return {
            ok: false as const,
            retryable: outcome.retryable,
            status: error instanceof HttpError ? error.status : undefined,
            retryAfterSeconds: error instanceof HttpError ? error.retryAfterSeconds : undefined,
            message: error instanceof Error ? error.message : String(error),
            attempts: outcome.attempts,
          };
        },
      }),
    },
  });
}
