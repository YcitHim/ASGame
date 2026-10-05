/**
 * core/combat/relics · 遗物触发（数据驱动，ADR-004/005 精神）
 *
 * 遗物 = data/relics/*.json 里的 { timing, effects, once }；核心只按时机派发，
 * 不改代码即可新增遗物。
 */
import type { EventSink } from "../events/event-sink";
import type { TriggerTiming } from "../registry/content";
import type { Draft } from "./draft";
import { resolveEffects } from "./resolve";

/** 回合开始时清空 once:turn 的触发记录。 */
export function resetTurnRelics(draft: Draft): void {
  draft.player.triggeredThisTurn = [];
}

/** 按时机派发全部遗物效果。 */
export function resolveRelics(draft: Draft, sink: EventSink, timing: TriggerTiming): void {
  for (const id of draft.player.relics) {
    const def = draft.content.relics.get(id);
    if (!def || def.timing !== timing) continue;
    if (def.once === "battle" && draft.player.triggeredThisBattle.includes(id)) continue;
    if (def.once === "turn" && draft.player.triggeredThisTurn.includes(id)) continue;

    resolveEffects(draft, sink, def.effects, {
      sourceId: `relic:${id}`,
      actorId: "player",
      chosenTargetId: null,
    });

    if (def.once === "battle") draft.player.triggeredThisBattle.push(id);
    if (def.once === "turn") draft.player.triggeredThisTurn.push(id);
  }
}
