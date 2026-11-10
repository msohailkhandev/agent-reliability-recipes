import { describe, expect, it } from 'vitest';
import { createBrokenAgent, createFixedAgent, shippingEmailKey } from '../src/agent.js';
import { FakeEmailApi, IdempotencyKeyReusedError } from '../src/fake-email-api.js';
import { createRetryingModel } from '../src/mock-model.js';

const prompt = 'Order A-1001 has shipped. Email sara@example.com.';

describe('recipe 02: idempotent tool calls', () => {
  it('broken agent: a timeout after sending makes the customer get the email twice', async () => {
    const api = new FakeEmailApi();
    api.timeoutAfterNextSend();
    const result = await createBrokenAgent(createRetryingModel(), api).generate({ prompt });

    expect(api.requests).toBe(2);
    expect(api.delivered).toHaveLength(2);
    expect(api.delivered[0]?.subject).toBe(api.delivered[1]?.subject);
    expect(result.text).toBe('Done. The shipping email has been sent.');
  });

  it('fixed agent: the retry is replayed by the provider, so only one email is sent', async () => {
    const api = new FakeEmailApi();
    api.timeoutAfterNextSend();
    const result = await createFixedAgent(createRetryingModel(), api).generate({ prompt });

    expect(api.requests).toBe(2);
    expect(api.delivered).toHaveLength(1);
    // The retry got back the result of the first, real send.
    const retryOutput = result.steps[1]?.toolResults[0]?.output;
    expect(retryOutput).toEqual({ messageId: 'msg_1' });
    expect(result.text).toBe('Done. The shipping email has been sent.');
  });

  it('toolCallId cannot be the idempotency key: each retry gets a new one', async () => {
    const api = new FakeEmailApi();
    api.timeoutAfterNextSend();
    const result = await createFixedAgent(createRetryingModel(), api).generate({ prompt });

    const ids = result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolCallId));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('different orders still get their own emails', async () => {
    const api = new FakeEmailApi();
    const model = createRetryingModel([
      { orderId: 'A-1001', to: 'sara@example.com' },
      { orderId: 'A-1002', to: 'sara@example.com' },
    ]);
    await createFixedAgent(model, api).generate({ prompt: 'Both orders shipped. Email Sara for each.' });

    expect(api.delivered.map((email) => email.subject)).toEqual([
      'Your order A-1001 has shipped',
      'Your order A-1002 has shipped',
    ]);
  });

  it('a healthy run sends exactly one email with one request', async () => {
    const api = new FakeEmailApi();
    await createFixedAgent(createRetryingModel(), api).generate({ prompt });
    expect(api.requests).toBe(1);
    expect(api.delivered).toHaveLength(1);
  });

  it('the provider rejects a reused key with different parameters', async () => {
    const api = new FakeEmailApi();
    const key = shippingEmailKey('A-1001');
    await api.send({ to: 'sara@example.com', subject: 'a', body: 'b' }, { idempotencyKey: key });
    await expect(
      api.send({ to: 'sara@example.com', subject: 'DIFFERENT', body: 'b' }, { idempotencyKey: key }),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    expect(api.delivered).toHaveLength(1);
  });
});
