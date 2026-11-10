import { isStepCount, tool, ToolLoopAgent, type LanguageModel } from 'ai';
import { z } from 'zod';
import { createGuards, type ModelPrice } from './guards.js';

/**
 * A tool that keeps answering "pending". This is the classic loop trigger:
 * the model is told to wait until the order ships, so it checks again, and again.
 */
export const tools = {
  checkOrderStatus: tool({
    description: 'Check the shipping status of an order.',
    inputSchema: z.object({ orderId: z.string() }),
    execute: async ({ orderId }) => ({ orderId, status: 'pending' as const }),
  }),
};

const instructions = 'Tell the user once their order has shipped.';

/**
 * BROKEN: someone raised the step cap "so the agent can finish".
 * Nothing notices that it is asking the same question over and over.
 */
export function createBrokenAgent(model: LanguageModel) {
  return new ToolLoopAgent({
    model,
    instructions,
    tools,
    stopWhen: isStepCount(50),
  });
}

/**
 * FIXED: keep a step cap as the last line of defence, and add two guards
 * that stop the loop early and say why.
 * Create a new agent (and guards) per run, so the stop reason is per run.
 */
export function createFixedAgent(model: LanguageModel, price: ModelPrice) {
  const guards = createGuards({ maxRepeats: 3, maxCostUsd: 0.1, price });
  const agent = new ToolLoopAgent({
    model,
    instructions,
    tools,
    stopWhen: [isStepCount(20), ...guards.stopWhen],
  });
  return { agent, stopReason: guards.reason };
}
