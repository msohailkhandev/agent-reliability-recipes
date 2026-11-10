import { createBrokenAgent, createFixedAgent } from './agent.js';
import { costOfSteps, type ModelPrice } from './guards.js';
import { createLoopingModel } from './mock-model.js';

// Example price only. Use your provider's real numbers.
const price: ModelPrice = { inputPerMillion: 3, outputPerMillion: 15 };
const prompt = 'Has order A-1001 shipped yet?';

const broken = await createBrokenAgent(createLoopingModel()).generate({ prompt });
console.log('BROKEN agent');
console.log(`  model calls: ${broken.steps.length}`);
console.log(`  cost:        $${costOfSteps(broken.steps, price).toFixed(4)}`);

const { agent, stopReason } = createFixedAgent(createLoopingModel(), price);
const fixed = await agent.generate({ prompt });
console.log('FIXED agent');
console.log(`  model calls: ${fixed.steps.length}`);
console.log(`  cost:        $${costOfSteps(fixed.steps, price).toFixed(4)}`);
console.log(`  stopped by:  ${JSON.stringify(stopReason())}`);
