import { MockLanguageModelV4 } from 'ai/test';

/**
 * A fake model that always asks to check the same order again.
 * It lets the recipe run offline, with no API key and no cost.
 */
export function createLoopingModel(tokensPerStep = { input: 2_000, output: 50 }) {
  let call = 0;
  return new MockLanguageModelV4({
    modelId: 'mock-looping-model',
    doGenerate: async () => {
      call += 1;
      return {
        content: [
          {
            type: 'tool-call',
            toolCallId: `call-${call}`,
            toolName: 'checkOrderStatus',
            input: JSON.stringify({ orderId: 'A-1001' }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: { total: tokensPerStep.input, noCache: tokensPerStep.input, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: tokensPerStep.output, text: tokensPerStep.output, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}
