import { MockLanguageModelV4 } from 'ai/test';

type ToolCall = { orderId: string; to: string };

const usage = {
  inputTokens: { total: 500, noCache: 500, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

/**
 * A fake model that behaves like a helpful real one:
 * - asks to send the email (once per order in `orders`);
 * - if the last tool result is an error (for example a timeout), it tries again;
 * - once every send succeeded, it answers in text.
 */
export function createRetryingModel(orders: ToolCall[] = [{ orderId: 'A-1001', to: 'sara@example.com' }]) {
  let call = 0;
  let next = 0; // index of the order we are currently trying to send
  return new MockLanguageModelV4({
    modelId: 'mock-retrying-model',
    doGenerate: async ({ prompt }) => {
      call += 1;
      const last = prompt.at(-1);
      if (last?.role === 'tool') {
        const result = last.content.find((part) => part.type === 'tool-result');
        const failed = result?.type === 'tool-result' && result.output.type === 'error-text';
        if (!failed) next += 1; // success: move on to the next order
      }

      const order = orders[next];
      if (!order) {
        return {
          content: [{ type: 'text', text: 'Done. The shipping email has been sent.' }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage,
          warnings: [],
        };
      }
      return {
        content: [
          {
            type: 'tool-call',
            toolCallId: `call-${call}`,
            toolName: 'sendShippingEmail',
            input: JSON.stringify(order),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage,
        warnings: [],
      };
    },
  });
}
