/**
 * headless-sim · 最简启发式 AI（能出牌就出、优先攻击、低血会防）
 *
 * 只读卡面 JSON（不算强化），够用来做数值体检；不是"会玩"的 AI。
 */
import type { CardDefinition, ContentDb } from "../../../src/core/registry";
import type { BattleState } from "../../../src/core/combat";
import { cardEnergyCost, validatePlayCardState } from "../../../src/core/combat";
import { pactHpCost } from "../../../src/core/keywords";

export interface CardScore {
  index: number;
  score: number;
}

/**
 * 卡面伤害。条件伤害只有在"当前确实满足"时才计入（docs/16 P1.4 AI 评分增强）：
 * 否则 AI 会把「以血还血」恒当成 14 伤，2 费打 8 点，白亏能量。
 */
function damageOf(def: CardDefinition, tookDamageThisTurn = false): number {
  const effects = def.effects ?? [];
  let total = 0;
  let conditionalOnly = false;
  for (const e of effects) {
    if (e.kind !== "damage") continue;
    const value = e.value ?? 0;
    if (!e.condition) {
      total += value;
      continue;
    }
    conditionalOnly = true;
    const type = (e.condition as { type?: string }).type;
    if (type === "tookDamageThisTurn" && tookDamageThisTurn) total += value;
  }
  if (total > 0) return total;
  if (conditionalOnly) return 0;
  const params = def.play?.params ?? {};
  const value = typeof params["value"] === "number" ? params["value"] : 0;
  const hits = typeof params["hits"] === "number" ? params["hits"] : 1;
  return value * hits;
}

function blockOf(def: CardDefinition): number {
  return (def.effects ?? []).filter((e) => e.kind === "block").reduce((a, e) => a + (e.value ?? 0), 0);
}

function drawOf(def: CardDefinition): number {
  return (def.effects ?? []).filter((e) => e.kind === "draw").reduce((a, e) => a + (e.value ?? 0), 0);
}

/** 卡面价值（奖励三选一用）。 */
export function cardValue(def: CardDefinition): number {
  return damageOf(def) * 1.2 + blockOf(def) * 0.7 + drawOf(def) * 1.5;
}

/** 给手牌打分：低血偏防御，常规偏输出。 */
export function scoreHand(state: BattleState, content: ContentDb): CardScore[] {
  const lowHp = state.player.hp / Math.max(1, state.player.maxHp) < 0.5;
  return state.piles.hand.map((instanceId, index) => {
    const instance = state.cardInstances[instanceId];
    const def = content.cards.get(instance.cardId);
    if (!def) return { index, score: -1 };
    if (cardEnergyCost(def, instance) > state.player.energy) return { index, score: -1 };

    const blood = pactHpCost({ keywords: def.keywords, bloodCost: def.bloodCost });
    if (blood > 0 && state.player.hp <= blood + 4) return { index, score: -1 };

    const attack = damageOf(def, state.tookDamageThisTurn);
    const block = blockOf(def);
    const draw = drawOf(def);
    let score = attack * 1.2 + block * (lowHp ? 1.4 : 0.7) + draw * 1.5;
    if (score <= 0) score = 0.5;
    return { index, score };
  });
}

/**
 * 出牌：按分数从高到低，返回第一张"真的能打"的牌；
 * 全都打不了才返回 null（交给主循环 EndTurn）。
 */
export function choosePlay(state: BattleState, content: ContentDb, targetId: string | null): number | null {
  const scored = scoreHand(state, content)
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  for (const candidate of scored) {
    if (validatePlayCardState(state, candidate.index, targetId).ok) return candidate.index;
  }
  return null;
}

/** 选择攻击目标：血最少的存活敌人。 */
export function chooseTarget(state: BattleState): string | undefined {
  const alive = state.enemies.filter((e) => e.hp > 0);
  if (alive.length === 0) return undefined;
  return alive.reduce((a, b) => (b.hp < a.hp ? b : a)).id;
}
