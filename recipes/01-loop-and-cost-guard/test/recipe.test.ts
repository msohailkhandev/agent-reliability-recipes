import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { createBrokenAgent, createFixedAgent } from '../src/agent.js';
import { canonical, costOfSteps, type ModelPrice } from '../src/guards.js';
import { createLoopingModel } from '../src/mock-model.js';

const price: ModelPrice = { inputPerMillion: 3, outputPerMillion: 15 };
const prompt = 'Has order A-1001 shipped yet?';

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

/** Calls the tool with a NEW order id every time, so the repeat guard never fires. */
function createWanderingModel(input: number, output: number) {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      call += 1;
      return {
        content: [
          {
            type: 'tool-call',
            toolCallId: `call-${call}`,
            toolName: 'checkOrderStatus',
            input: JSON.stringify({ orderId: `A-${call}` }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: usage(input, output),
        warnings: [],
      };
    },
  });
}

/** Calls the tool once, then answers. A normal, healthy run. */
function createHealthyModel() {
  return new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'checkOrderStatus', input: '{"orderId":"A-1001"}' },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: usage(500, 20),
        warnings: [],
      },
      {
        content: [{ type: 'text', text: 'Your order is still pending.' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: usage(600, 20),
        warnings: [],
      },
    ],
  });
}

describe('recipe 01: loop and cost guard', () => {
  it('broken agent keeps calling the same tool until the step cap (50 calls)', async () => {
    const model = createLoopingModel();
    const result = await createBrokenAgent(model).generate({ prompt });
    expect(model.doGenerateCalls).toHaveLength(50);
    expect(result.steps).toHaveLength(50);
  });

  it('fixed agent stops after 3 identical tool calls and says why', async () => {
    const model = createLoopingModel();
    const { agent, stopReason } = createFixedAgent(model, price);
    const result = await agent.generate({ prompt });
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(result.steps).toHaveLength(3);
    expect(stopReason()).toEqual({ rule: 'repeated-tool-call', toolName: 'checkOrderStatus', repeats: 3 });
  });

  it('cost guard stops a run whose calls differ but whose spend crosses $0.10', async () => {
    // Each step costs 10,000 x $3/M + 100 x $15/M = $0.0315, so the 4th step crosses $0.10.
    const model = createWanderingModel(10_000, 100);
    const { agent, stopReason } = createFixedAgent(model, price);
    const result = await agent.generate({ prompt });
    expect(result.steps).toHaveLength(4);
    const reason = stopReason();
    expect(reason?.rule).toBe('cost-limit');
    // Stop conditions run after a step finishes, so the run overshoots the limit by up to one step.
    expect(costOfSteps(result.steps, price)).toBeCloseTo(0.126, 6);
  });

  it('step cap still applies when calls differ and are cheap', async () => {
    const model = createWanderingModel(100, 10);
    const { agent, stopReason } = createFixedAgent(model, price);
    const result = await agent.generate({ prompt });
    expect(result.steps).toHaveLength(20);
    expect(stopReason()).toBeNull();
  });

  it('does not interfere with a healthy run', async () => {
    const { agent, stopReason } = createFixedAgent(createHealthyModel(), price);
    const result = await agent.generate({ prompt });
    expect(result.steps).toHaveLength(2);
    expect(result.text).toBe('Your order is still pending.');
    expect(stopReason()).toBeNull();
  });

  it('treats inputs with different key order as the same call', () => {
    expect(canonical({ a: 1, b: { d: 2, c: 3 } })).toBe(canonical({ b: { c: 3, d: 2 }, a: 1 }));
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: 2 }));
  });
});
