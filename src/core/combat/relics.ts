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
import type { Draft } from "./draft";
import { resolveEffects } from "./resolve";

/** 回合开始时清空 once:turn 的触发记录。 */
export function resetTurnRelics(draft: Draft): void {
  draft.player.triggeredThisTurn = [];
}

/** 取某个卡牌实例当前生效的能力定义（升级版覆盖基础版）。 */
export function powerOf(draft: Draft, instanceId: string): CardPower | undefined {
  const instance = draft.cardInstances[instanceId];
  if (!instance) return undefined;
  const def = draft.content.cards.get(instance.cardId);
  if (!def) return undefined;
  return instance.upgraded ? (def.upgraded?.power ?? def.power) : def.power;
}

/** 按时机派发全部遗物与卡牌能力效果。 */
export function resolveTriggers(draft: Draft, sink: EventSink, timing: TriggerTiming): void {
  for (const id of draft.player.relics) {
    const def = draft.content.relics.get(id);
    if (!def || def.timing !== timing) continue;
    if (def.once === "battle" && draft.player.triggeredThisBattle.includes(id)) continue;
    if (def.once === "turn" && draft.player.triggeredThisTurn.includes(id)) continue;

    resolveEffects(draft, sink, def.effects, {
      sourceId: `relic:${id}`,
      actorId: "player",
      chosenTargetId: null,
      fromTrigger: true,
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

    resolveEffects(draft, sink, power.effects, {
      sourceId: instanceId,
      actorId: "player",
      chosenTargetId: null,
      fromTrigger: true,
    });

    if (power.once === "battle") draft.player.triggeredThisBattle.push(key);
    if (power.once === "turn") draft.player.triggeredThisTurn.push(key);
  }
}

/** @deprecated 使用 resolveTriggers；保留别名以免旧测试断裂。 */
export const resolveRelics = resolveTriggers;
