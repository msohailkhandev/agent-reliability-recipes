import type { StepResult, StopCondition, ToolSet } from 'ai';

/** Why a guard stopped the run. `null` means no guard fired. */
export type StopReason =
  | { rule: 'repeated-tool-call'; toolName: string; repeats: number }
  | { rule: 'cost-limit'; spentUsd: number; limitUsd: number }
  | null;

/**
 * Prices in USD per 1 million tokens.
 * These are YOUR numbers: copy them from your provider's pricing page.
 * Prices change, so this recipe never hard-codes real ones.
 */
export type ModelPrice = { inputPerMillion: number; outputPerMillion: number };

export type GuardOptions = {
  /** Stop when the same tool is called with the same input this many times in a row. */
  maxRepeats: number;
  /** Stop once the run has spent at least this much (USD). */
  maxCostUsd: number;
  /** Price of the model this agent uses. */
  price: ModelPrice;
};

/** Stable string for a tool input, so `{a:1,b:2}` and `{b:2,a:1}` count as the same call. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** Total USD spent across all steps so far. Missing token counts are treated as 0. */
export function costOfSteps(steps: ReadonlyArray<StepResult<ToolSet>>, price: ModelPrice): number {
  let usd = 0;
  for (const step of steps) {
    usd += ((step.usage.inputTokens ?? 0) / 1_000_000) * price.inputPerMillion;
    usd += ((step.usage.outputTokens ?? 0) / 1_000_000) * price.outputPerMillion;
  }
  return usd;
}

/**
 * Creates two stop conditions for an AI SDK agent loop and remembers which one fired.
 * Pass `guards.stopWhen` into `stopWhen` together with a step cap such as `isStepCount(20)`.
 */
export function createGuards(options: GuardOptions) {
  let reason: StopReason = null;

  const repeatedToolCall: StopCondition<ToolSet> = ({ steps }) => {
    const calls = steps.flatMap((step) => step.toolCalls);
    if (calls.length < options.maxRepeats) return false;
    const recent = calls.slice(-options.maxRepeats);
    const first = recent[0];
    if (!first) return false;
    const key = `${first.toolName}:${canonical(first.input)}`;
    const allSame = recent.every((call) => `${call.toolName}:${canonical(call.input)}` === key);
    if (allSame) {
      reason = { rule: 'repeated-tool-call', toolName: first.toolName, repeats: options.maxRepeats };
    }
    return allSame;
  };

  const costLimit: StopCondition<ToolSet> = ({ steps }) => {
    const spentUsd = costOfSteps(steps, options.price);
    if (spentUsd >= options.maxCostUsd) {
      reason = { rule: 'cost-limit', spentUsd, limitUsd: options.maxCostUsd };
      return true;
    }
    return false;
  };

  return {
    stopWhen: [repeatedToolCall, costLimit],
    /** Which guard stopped the last run, or `null` if none did. */
    reason: (): StopReason => reason,
  };
}
