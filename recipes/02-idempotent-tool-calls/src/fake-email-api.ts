/**
 * A fake email provider, so the recipe runs offline.
 *
 * It behaves like real providers that support idempotency keys (Stripe works this way for POST requests):
 * - The first request with a key is executed and its result is saved.
 * - A retry with the same key returns the saved result and does NOT send again.
 * - Reusing a key with different parameters is an error.
 *
 * `timeoutAfterNextSend()` simulates the dangerous case: the email IS sent,
 * but the response is lost, so the caller sees a timeout.
 */
export type Email = { to: string; subject: string; body: string };
export type SendResult = { messageId: string };

export class TimeoutError extends Error {
  constructor() {
    super('Request timed out after 30s (no response received)');
    this.name = 'TimeoutError';
  }
}

export class IdempotencyKeyReusedError extends Error {
  constructor(key: string) {
    super(`Idempotency key "${key}" was already used with different parameters`);
    this.name = 'IdempotencyKeyReusedError';
  }
}

export class FakeEmailApi {
  /** Every email actually delivered to an inbox. */
  readonly delivered: Array<Email & SendResult> = [];
  /** Number of HTTP requests received. */
  requests = 0;

  private saved = new Map<string, { params: string; result: SendResult }>();
  private loseNextResponse = false;

  timeoutAfterNextSend() {
    this.loseNextResponse = true;
  }

  async send(email: Email, options: { idempotencyKey?: string } = {}): Promise<SendResult> {
    this.requests += 1;
    const { idempotencyKey } = options;
    const params = JSON.stringify(email);

    if (idempotencyKey) {
      const previous = this.saved.get(idempotencyKey);
      if (previous) {
        if (previous.params !== params) throw new IdempotencyKeyReusedError(idempotencyKey);
        return previous.result; // replay: nothing is sent again
      }
    }

    const result = { messageId: `msg_${this.delivered.length + 1}` };
    this.delivered.push({ ...email, ...result });
    if (idempotencyKey) this.saved.set(idempotencyKey, { params, result });

    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new TimeoutError(); // the email went out, but the caller never hears about it
    }
    return result;
  }
}
