import { createBrokenAgent, createFixedAgent } from './agent.js';
import { alwaysInvalidAddress, FakeShippingApi } from './fake-shipping-api.js';
import { createQuoteModel } from './mock-model.js';

const prompt = 'How much to ship to 12 Unknown Street?';

const brokenApi = new FakeShippingApi(alwaysInvalidAddress);
const broken = await createBrokenAgent(createQuoteModel(), brokenApi).generate({ prompt });
console.log('BROKEN agent');
console.log(`  requests to shipping API: ${brokenApi.requests}`);
console.log(`  model calls:              ${broken.steps.length}`);

const fixedApi = new FakeShippingApi(alwaysInvalidAddress);
const fixed = await createFixedAgent(createQuoteModel(), fixedApi, {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 5_000,
}).generate({ prompt });
console.log('FIXED agent');
console.log(`  requests to shipping API: ${fixedApi.requests}`);
console.log(`  model calls:              ${fixed.steps.length}`);
console.log(`  answer:                   ${fixed.text}`);
