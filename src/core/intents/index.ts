/**
 * core/intents · 敌人意图 AI（数据驱动，意图表存 data/enemies）
 *
 * 意图生成只消费 combat RNG 流；生成后发 IntentRevealed，UI 全程图标可见。
 * 预留：多段行动、阶段转换、召唤（结构不堵死，0.1 不实现）。
 */
import type { IntentPayload } from "../events";
import { evaluateCondition, type ConditionContext } from "../registry/condition";
import type { EnemyDefinition, EnemyIntentEntry, IntentDefinition } from "../registry/content";
import type { RngStream } from "../rng";

export function intentKey(intent: IntentDefinition): string {
  return [intent.kind, intent.value ?? 0, intent.hits ?? 1, intent.buffId ?? ""].join(":");
}

export function intentToPayload(intent: IntentDefinition, thenIntent?: IntentDefinition): IntentPayload {
  const payload: IntentPayload = { kind: intent.kind };
  return {
    ...payload,
    ...(intent.value !== undefined ? { value: intent.value } : {}),
    ...(intent.hits !== undefined ? { hits: intent.hits } : {}),
    ...(intent.buffId !== undefined ? { buffId: intent.buffId } : {}),
    ...(thenIntent?.value !== undefined ? { thenValue: thenIntent.value } : {}),
  };
}

/** 尾部连续相同意图的计数（用于 maxConsecutive）。 */
export function trailingRepeat(history: readonly string[], key: string): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i] !== key) break;
    count += 1;
  }
  return count;
}

function eligible(
  def: EnemyDefinition,
  ctx: ConditionContext,
  history: readonly string[],
  enforceConsecutive: boolean,
): EnemyIntentEntry[] {
  return def.intents.filter((entry) => {
    if (entry.condition && !evaluateCondition(entry.condition, ctx)) return false;
    if (!enforceConsecutive) return true;
    const max = entry.maxConsecutive;
    if (max == null) return true;
    return trailingRepeat(history, intentKey(entry.intent)) < max;
  });
}

export interface IntentRoll {
  readonly intent: IntentPayload;
  readonly key: string;
  /** 本条带 thenIntent 时，下一个意图被强制成它 */
  readonly forcedNext?: IntentDefinition;
}

/**
 * 按意图表抽取下回合意图。
 * 条件不过滤掉全部候选时，放宽"连续限制"再抽一次（保证总有招可出）。
 */
export function generateIntent(
  def: EnemyDefinition,
  ctx: ConditionContext,
  history: readonly string[],
  rng: RngStream,
): IntentRoll {
  let pool = eligible(def, ctx, history, true);
  if (pool.length === 0) pool = eligible(def, ctx, history, false);
  if (pool.length === 0) {
    return { intent: { kind: "unknown" }, key: "unknown:0:1:" };
  }
  const entry = rng.weighted(pool.map((e) => [e, e.weight] as const));
  return {
    intent: intentToPayload(entry.intent, entry.thenIntent),
    key: intentKey(entry.intent),
    ...(entry.thenIntent ? { forcedNext: entry.thenIntent } : {}),
  };
}
