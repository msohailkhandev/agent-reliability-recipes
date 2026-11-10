# 03 · Stop a retry storm

**The failure:** a tool retries every error, instantly, several times — and then the model retries the tool. An error that can never succeed (an invalid address, a bad API key) turns into dozens of requests, hammers the other service, and burns tokens.

**The fix:** retry only errors that can succeed later, wait between attempts (honour `Retry-After`, otherwise exponential backoff with jitter), stop after a few attempts, and return a clear result that tells the model whether trying again could help.

![Broken agent sends 25 requests; fixed agent sends 1](../../assets/demo-03.gif)

## Run it (no API key)

```bash
npm install
npm run demo:03
npm test
```

Output of `npm run demo:03`:

```
BROKEN agent
  requests to shipping API: 25
  model calls:              5
FIXED agent
  requests to shipping API: 1
  model calls:              2
  answer:                   I could not get a quote: the address is invalid. Please check it.
```

The demo uses a fake shipping API that always answers `400 Invalid destination address`, and a mock model that tries again whenever a tool throws.

## What goes wrong

```ts
// src/agent.ts — BROKEN
execute: async ({ address }) => naiveRetry(() => api.getQuote(address)), // 5 attempts, no wait, any error
```

1. The API answers 400. `naiveRetry` asks 4 more times, instantly. Same answer.
2. The tool throws. The model only sees "an error happened", so it calls the tool again.
3. Each model retry multiplies into 5 more requests: **5 model calls × 5 attempts = 25 requests** for an answer that was never going to change.

Against a service that is genuinely overloaded, instant retries from many clients make the overload worse.

## The fix

```ts
// src/agent.ts — FIXED
const outcome = await retryWithBackoff(() => api.getQuote(address), retry);
if (outcome.ok) return { ok: true, ...outcome.value };
return { ok: false, retryable: outcome.retryable, status, retryAfterSeconds, message, attempts };
```

[`src/retry.ts`](src/retry.ts) does four things:

| Rule | Why |
| --- | --- |
| Retry only `408, 429, 500, 502, 503, 504` | These can succeed later. Other 4xx errors (bad input, auth, not found) fail the same way every time. |
| Wait `Retry-After` when the server sends it | The server is telling you when it can take the request. |
| Otherwise wait a random time between 0 and `min(maxDelayMs, baseDelayMs × 2^(attempt−1))` | Exponential backoff with full jitter; [AWS's analysis](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) found jittered backoff does much less work than backoff without jitter. |
| Stop after `maxAttempts`, or if `Retry-After` is longer than `maxDelayMs` | Bounded cost and latency. The tool reports `retryable: true` so the caller can try later. |

The tool then **returns** the failure instead of throwing it, with `retryable: false` for permanent errors, and its description tells the model not to call it again with the same input in that case.

## What the tests prove

[`test/recipe.test.ts`](test/recipe.test.ts), with a fake clock (no real waiting):

- Broken: a permanent 400 becomes 25 requests over 5 model calls.
- Fixed: a permanent 400 is tried **once**, no waiting, and the model answers instead of retrying.
- A short outage (503, 503, then 200) recovers after waits of 100 ms and 200 ms.
- A 429 with `Retry-After: 2` waits exactly 2,000 ms, then succeeds.
- A `Retry-After: 60` longer than `maxDelayMs` is not waited for; the tool reports `retryable: true`.
- A long outage stops after 3 attempts.
- Waits never exceed `maxDelayMs`.
- Exactly which statuses are retried.

## Limits — read before using this in production

- **Retrying a write needs an idempotency key.** Retrying a payment or an email after a timeout can do it twice. Use [recipe 02](../02-idempotent-tool-calls) together with this one.
- **The model may still retry.** A clear `retryable: false` gives it a reason to stop, but models don't always follow it. Keep the loop guard from [recipe 01](../01-loop-and-cost-guard) as a backstop.
- **`Retry-After` can be a date.** The header may hold seconds or an HTTP date ([MDN](https://developer.mozilla.org/docs/Web/HTTP/Headers/Retry-After)). This recipe's fake API only sends seconds; parse both in real code.
- **Pick the retryable list per API.** Some APIs return `409` for a temporary conflict that is safe to retry; others don't. Read your provider's docs.
- **Model calls are separate.** The AI SDK already retries failed *model* calls (`maxRetries`, default 2). This recipe is about *your tools*. For model-call retries and fallbacks, see [ai-retry](https://github.com/zirkelc/ai-retry).

## Versions

Tested with `ai@7.0.166` on Node 22.

## Files

| File | What it is |
| --- | --- |
| `src/retry.ts` | `naiveRetry` (broken), `isRetryable` and `retryWithBackoff` (fixed) |
| `src/agent.ts` | Broken and fixed agents |
| `src/fake-shipping-api.ts` | Offline API with scripted responses, `HttpError` and `Retry-After` |
| `src/mock-model.ts` | Offline mock model that follows the tool's result |
| `src/demo.ts` | Runs both agents and prints the comparison |
| `test/recipe.test.ts` | Tests for every claim on this page |
