/**
 * core/combat/relics · 触发派发（数据驱动，ADR-004/005 精神）
 *
 * 两类来源共用同一派发器：
 *  - 遗物 = data/relics/*.json 的 { timing, effects, once }（局外携带）；
 *  - 卡牌能力 = 卡牌 JSON 的 { power }（打出后记入 player.powers，docs/29 §一②）。
 * 核心只按时机派发，不改代码即可新增触发内容。
 */
import type { EventSink } from "../events/event-sink";
import type { CardPower, TriggerTiming } from "../registry/content";
import { evaluateCondition } from "../registry/condition";
import type { Draft } from "./draft";
import { conditionContext, resolveEffects, resolveEffectsInline } from "./resolve";

/** 回合开始时清空 once:turn 的触发记录与遗物 handler 的本回合计数（docs/64 §三）。 */
export function resetTurnRelics(draft: Draft): void {
  draft.player.triggeredThisTurn = [];
  draft.relicFiresThisTurn = {};
}

/** 取某个卡牌实例当前生效的能力定义（升级版覆盖基础版）。 */
export function powerOf(draft: Draft, instanceId: string): CardPower | undefined {
  const instance = draft.cardInstances[instanceId];
  if (!instance) return undefined;
  const def = draft.content.cards.get(instance.cardId);
  if (!def) return undefined;
  return instance.upgraded ? (def.upgraded?.power ?? def.power) : def.power;
}

/**
 * 「这次触发会不会真的产生效果」（docs/64 齿轮币 bug 修复）：
 * once:turn/battle 的消耗必须跟着「真的出手」走——老口径是派发即消耗，
 * 齿轮币（第 3 张牌才生效）在每回合第 1 张牌就把「每回合一次」白白了结，
 * 导致它**从来没触发过**（现版实锤 bug，p28 钉死回归）。
 * 保守口径：延迟效果（条件到期才求值）与求值异常一律当作「会出手」。
 */
function mayProduceEffect(draft: Draft, effects: CardPower["effects"]): boolean {
  return effects.some((e) => {
    if ((e as { delayTurns?: number }).delayTurns) return true;
    try {
      return evaluateCondition(e.condition, conditionContext(draft));
    } catch {
      return true;
    }
  });
}

/** 按时机派发全部遗物与卡牌能力效果。 */
export function resolveTriggers(
  draft: Draft,
  sink: EventSink,
  timing: TriggerTiming,
  opts: { inline?: boolean; targetId?: string | null } = {},
): void {
  const run = opts.inline ? resolveEffectsInline : resolveEffects;
  for (const id of draft.player.relics) {
    const def = draft.content.relics.get(id);
    // 规则件（docs/64 §三）没有 effects、只挂 handler → 数据派发直接跳过
    if (!def || def.timing !== timing || !def.effects || def.effects.length === 0) continue;
    if (def.once === "battle" && draft.player.triggeredThisBattle.includes(id)) continue;
    if (def.once === "turn" && draft.player.triggeredThisTurn.includes(id)) continue;
    // 条件全不满足 → 不消耗 once（齿轮币 bug：第 1 张牌白吃「每回合一次」）
    if (def.once && !mayProduceEffect(draft, def.effects)) continue;

    run(draft, sink, def.effects, {
      sourceId: `relic:${id}`,
      actorId: "player",
      chosenTargetId: opts.targetId ?? null,
      fromTrigger: true,
      triggerTiming: timing,
    });

    if (def.once === "battle") draft.player.triggeredThisBattle.push(id);
    if (def.once === "turn") draft.player.triggeredThisTurn.push(id);
  }

  for (const instanceId of draft.player.powers) {
    const power = powerOf(draft, instanceId);
    if (!power || power.timing !== timing) continue;
    const key = `power:${instanceId}`;
    if (power.once === "battle" && draft.player.triggeredThisBattle.includes(key)) continue;
    if (power.once === "turn" && draft.player.triggeredThisTurn.includes(key)) continue;
    // 与遗物同口径：条件全不满足不消耗 once
    if (power.once && !mayProduceEffect(draft, power.effects)) continue;

    run(draft, sink, power.effects, {
      sourceId: instanceId,
      actorId: "player",
      chosenTargetId: opts.targetId ?? null,
      fromTrigger: true,
      triggerTiming: timing,
    });

    if (power.once === "battle") draft.player.triggeredThisBattle.push(key);
    if (power.once === "turn") draft.player.triggeredThisTurn.push(key);
  }
}

/** @deprecated 使用 resolveTriggers；保留别名以免旧测试断裂。 */
export const resolveRelics = resolveTriggers;
