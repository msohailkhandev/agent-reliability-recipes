import { MockLanguageModelV4 } from 'ai/test';

const usage = {
  inputTokens: { total: 500, noCache: 500, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

const text = (value: string) => ({
  content: [{ type: 'text' as const, text: value }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage,
  warnings: [],
});

/**
 * A fake model that follows what the tool tells it:
 * - tool threw an error (it only sees "something failed") → tries again;
 * - tool returned ok: false, retryable: false → stops and explains;
 * - tool returned ok: false, retryable: true (still failing after retries) → stops and says try later;
 * - tool returned ok: true → answers with the quote.
 *
 * Real models usually respect a clear "retryable: false", but not always.
 * Keep the loop guard from recipe 01 as a backstop.
 */
export function createQuoteModel(address = '12 Unknown Street') {
  let call = 0;
  return new MockLanguageModelV4({
    modelId: 'mock-quote-model',
    doGenerate: async ({ prompt }) => {
      call += 1;
      const last = prompt.at(-1);
      if (last?.role === 'tool') {
        const result = last.content.find((part) => part.type === 'tool-result');
        if (result?.type === 'tool-result' && result.output.type === 'json') {
          const value = result.output.value as { ok: boolean; retryable?: boolean; quoteUsd?: number };
          if (value.ok) return text(`Shipping costs $${value.quoteUsd}.`);
          if (value.retryable === false) return text('I could not get a quote: the address is invalid. Please check it.');
          return text('The shipping service is busy right now. Please try again later.');
        }
        // error-text: the model only knows something failed, so it tries again.
      }
      return {
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: `call-${call}`,
            toolName: 'getShippingQuote',
            input: JSON.stringify({ address }),
          },
        ],
        finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
        usage,
        warnings: [],
      };
    },
  });
}
