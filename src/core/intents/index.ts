/**
 * core/intents · 敌人意图 AI（数据驱动，意图表存 data/enemies）
 *
 * 意图生成只消费 combat RNG 流；生成后发 IntentRevealed，UI 全程图标可见。
 * 蓄力链（docs/18 Q1）：蓄 →（可再蓄）→ 释放；释放值 = 普攻基准 + 蓄力值 × 层数，
 * 在链上一次性算死，运行期不记账、释放即消耗（不残留、不滚雪球）。
 */
import type { IntentPayload } from "../events";
import { buffStacks } from "../buffs";
import { evaluateCondition, type ConditionContext } from "../registry/condition";
import type { EnemyDefinition, EnemyIntentEntry, IntentDefinition } from "../registry/content";
import type { RngStream } from "../rng";

export function intentKey(intent: IntentDefinition): string {
  const base = [intent.kind, intent.value ?? 0, intent.hits ?? 1, intent.buffId ?? ""];
  if (intent.enemyId) base.push(intent.enemyId);
  return base.join(":");
}

export function intentToPayload(intent: IntentDefinition): IntentPayload {
  return {
    kind: intent.kind,
    ...(intent.value !== undefined ? { value: intent.value } : {}),
    ...(intent.hits !== undefined ? { hits: intent.hits } : {}),
    ...(intent.buffId !== undefined ? { buffId: intent.buffId } : {}),
    ...(intent.stacks !== undefined ? { stacks: intent.stacks } : {}),
    ...(intent.duration !== undefined ? { duration: intent.duration } : {}),
    ...(intent.block !== undefined ? { block: intent.block } : {}),
    ...(intent.enemyId !== undefined ? { enemyId: intent.enemyId } : {}),
    ...(intent.count !== undefined ? { count: intent.count } : {}),
    ...(intent.lifesteal !== undefined ? { lifesteal: intent.lifesteal } : {}),
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

export interface ChargeChain {
  /** 链上的蓄力环数值（至少 1 个） */
  readonly chargeValues: readonly number[];
  /** 末端释放值：普攻基准 + 蓄力值 × 层数，或被 releaseOverride 覆盖 */
  readonly releaseValue: number;
  /** 完整动作序列：蓄力环 → 释放攻击 */
  readonly steps: readonly IntentPayload[];
}

/** 把一条蓄力意图沿 thenIntent 展开成蓄力链（docs/18 Q1/Q2）。 */
export function buildChargeChain(charge: IntentDefinition): ChargeChain {
  const chargeValues: number[] = [];
  let cursor: IntentDefinition | undefined = charge;
  let terminal: IntentDefinition | undefined;
  while (cursor) {
    if (cursor.kind === "charge") {
      chargeValues.push(cursor.value ?? 0);
      cursor = cursor.thenIntent;
      continue;
    }
    terminal = cursor;
    break;
  }

  const base = terminal?.kind === "attack" ? (terminal.value ?? 0) : 0;
  const bonus = chargeValues.reduce((sum, value) => sum + value, 0);
  const releaseValue = charge.releaseOverride ?? base + bonus;

  const steps: IntentPayload[] = [];
  let link: IntentDefinition | undefined = charge;
  let remaining = chargeValues.length;
  while (link && link.kind === "charge") {
    steps.push({ ...intentToPayload(link), thenValue: releaseValue, thenIn: remaining });
    remaining -= 1;
    link = link.thenIntent;
  }
  steps.push({
    kind: "attack",
    value: releaseValue,
    ...(terminal?.hits !== undefined ? { hits: terminal.hits } : {}),
    // 释放段携带的附加减益（docs/47 §四：链枷手「震慑重击」命中附加眩晕）
    ...(terminal?.buffId !== undefined
      ? { buffId: terminal.buffId, ...(terminal.stacks !== undefined ? { stacks: terminal.stacks } : {}) }
      : {}),
    released: true,
  });

  return { chargeValues, releaseValue, steps };
}

/** 追击条件（docs/47 §三.3）：玩家身上层数不够，这条就不该被抽中。 */
function playerBuffOk(entry: EnemyIntentEntry, ctx: ConditionContext): boolean {
  const need = entry.playerBuff;
  if (!need) return true;
  return buffStacks(ctx.buffs, need.buffId) >= need.minStacks;
}

/** 连续限制：同一条最多连出 maxConsecutive 次。 */
function consecutiveOk(entry: EnemyIntentEntry, history: readonly string[]): boolean {
  const max = entry.maxConsecutive;
  if (max == null) return true;
  return trailingRepeat(history, intentKey(entry.intent)) < max;
}

/**
 * 整场一次（docs/60 §七，沉钟唱诗长二阶段的「虚化」）：`once` 的条目抽中过一次后
 * 永久退出候选池——判定用 intentHistory 里的 key，所以跨阶段也不会再抽到。
 */
function onceOk(entry: EnemyIntentEntry, history: readonly string[]): boolean {
  if (!entry.once) return true;
  return !history.includes(intentKey(entry.intent));
}

/** 召唤可用性上下文（docs/40 §五-2/3）：场上总数与某召唤物已有数量。 */
export interface SummonContext {
  readonly fieldCount: number;
  readonly maxField: number;
  readonly aliveDefIds: readonly string[];
}

/** 召唤意图是否可用：场上未满员 且 该召唤物数量 < maxSummons。 */
export function summonUsable(intent: IntentDefinition, ctx: SummonContext | undefined): boolean {
  if (intent.kind !== "summon" || !intent.enemyId) return true;
  if (!ctx) return true;
  if (ctx.fieldCount >= ctx.maxField) return false;
  const alive = ctx.aliveDefIds.filter((id) => id === intent.enemyId).length;
  const cap = intent.maxSummons ?? Number.POSITIVE_INFINITY;
  return alive < cap;
}

export interface IntentRoll {
  readonly intent: IntentPayload;
  readonly key: string;
  /** 蓄力链的剩余环节（不含首环）；非蓄力招式无此字段 */
  readonly chain?: readonly IntentPayload[];
}

/** 把抽中的一条展开成 IntentRoll（蓄力走链，其余直传）。 */
function rollEntry(entry: EnemyIntentEntry): IntentRoll {
  if (entry.intent.kind === "charge") {
    const { steps } = buildChargeChain(entry.intent);
    const first = steps[0];
    if (!first) return { intent: { kind: "unknown" }, key: "unknown:0:1:" };
    return { intent: first, key: intentKey(entry.intent), chain: steps.slice(1) };
  }
  return { intent: intentToPayload(entry.intent), key: intentKey(entry.intent) };
}

/**
 * 按意图表抽取下回合意图。
 * 顺序：**节拍技优先**（docs/47 §三.2，回合数到点直接顶替）→ 常规按 weight 抽。
 * 条件/追击/召唤/连续限制全过滤光时，放宽"连续限制"再抽一次（保证总有招可出）。
 * 抽到蓄力时展开成链：首环立刻揭示，其余环节写进 forcedChain。
 */
export function generateIntent(
  def: EnemyDefinition,
  ctx: ConditionContext,
  history: readonly string[],
  rng: RngStream,
  summon?: SummonContext,
  turn = 0,
): IntentRoll {
  const usable = (entry: EnemyIntentEntry): boolean =>
    summonUsable(entry.intent, summon) && playerBuffOk(entry, ctx);
  const passable = (entry: EnemyIntentEntry): boolean =>
    (!entry.condition || evaluateCondition(entry.condition, ctx)) && usable(entry) && onceOk(entry, history);

  // 节拍技：回合数 %N == 0 的条目按数组序强制顶替（同回合多条取第一条）
  if (turn > 0) {
    for (const entry of def.intents) {
      if (entry.everyTurns == null || turn % entry.everyTurns !== 0) continue;
      if (!passable(entry) || !consecutiveOk(entry, history)) continue;
      return rollEntry(entry);
    }
  }

  let pool = def.intents.filter((entry) => passable(entry) && consecutiveOk(entry, history));
  if (pool.length === 0) pool = def.intents.filter(passable);
  if (pool.length === 0) {
    // 召唤不可用时的兜底（docs/40 §五-2）：退回该敌人最低档普攻；没有普攻则 unknown
    const attacks = def.intents.filter((e) => e.intent.kind === "attack");
    if (attacks.length > 0) {
      const min = attacks.reduce((m, e) => Math.min(m, e.intent.value ?? Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);
      if (Number.isFinite(min)) return { intent: { kind: "attack", value: min }, key: `attack:${min}:1:` };
    }
    return { intent: { kind: "unknown" }, key: "unknown:0:1:" };
  }
  const entry = rng.weighted(pool.map((e) => [e, e.weight] as const));
  return rollEntry(entry);
}
