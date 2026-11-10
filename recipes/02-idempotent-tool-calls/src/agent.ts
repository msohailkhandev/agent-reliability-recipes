import { isStepCount, tool, ToolLoopAgent, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { FakeEmailApi } from './fake-email-api.js';

const inputSchema = z.object({
  orderId: z.string(),
  to: z.string(),
});

const instructions = 'When asked, send the shipping confirmation email for the order.';

function shippingEmail(orderId: string, to: string) {
  return {
    to,
    subject: `Your order ${orderId} has shipped`,
    body: `Good news: order ${orderId} is on its way.`,
  };
}

/**
 * BROKEN: the tool sends the email with no idempotency key.
 * If the provider times out AFTER sending, the tool throws, the model sees the error,
 * and it calls the tool again. The customer gets the email twice.
 */
export function createBrokenAgent(model: LanguageModel, api: FakeEmailApi) {
  return new ToolLoopAgent({
    model,
    instructions,
    stopWhen: isStepCount(10),
    tools: {
      sendShippingEmail: tool({
        description: 'Send the shipping confirmation email for an order.',
        inputSchema,
        execute: async ({ orderId, to }) => api.send(shippingEmail(orderId, to)),
      }),
    },
  });
}

/**
 * The key must be the same every time the agent tries to do THIS action,
 * and different for a different action. So it is built from the business intent:
 * "the shipping email for this order". It is not the toolCallId (a retry gets a new one)
 * and not a random UUID created inside `execute` (a retry would create a new one).
 * It contains no personal data (Stripe advises against emails or personal IDs in keys).
 */
export function shippingEmailKey(orderId: string) {
  return `shipping-email:${orderId}`;
}

/** FIXED: same tool, but every send carries an intent-based idempotency key. */
export function createFixedAgent(model: LanguageModel, api: FakeEmailApi) {
  return new ToolLoopAgent({
    model,
    instructions,
    stopWhen: isStepCount(10),
    tools: {
      sendShippingEmail: tool({
        description: 'Send the shipping confirmation email for an order.',
        inputSchema,
        execute: async ({ orderId, to }) =>
          api.send(shippingEmail(orderId, to), { idempotencyKey: shippingEmailKey(orderId) }),
      }),
    },
  });
}
