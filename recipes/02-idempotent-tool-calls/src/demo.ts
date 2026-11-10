import { createBrokenAgent, createFixedAgent } from './agent.js';
import { FakeEmailApi } from './fake-email-api.js';
import { createRetryingModel } from './mock-model.js';

const prompt = 'Order A-1001 has shipped. Email sara@example.com.';

const brokenApi = new FakeEmailApi();
brokenApi.timeoutAfterNextSend();
await createBrokenAgent(createRetryingModel(), brokenApi).generate({ prompt });
console.log('BROKEN agent');
console.log(`  requests to email API: ${brokenApi.requests}`);
console.log(`  emails delivered:      ${brokenApi.delivered.length}`);

const fixedApi = new FakeEmailApi();
fixedApi.timeoutAfterNextSend();
await createFixedAgent(createRetryingModel(), fixedApi).generate({ prompt });
console.log('FIXED agent');
console.log(`  requests to email API: ${fixedApi.requests}`);
console.log(`  emails delivered:      ${fixedApi.delivered.length}`);
