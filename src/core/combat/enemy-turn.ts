/**
 * core/combat/enemy-turn · 敌人行动：意图生成（intents/）与执行
 */
import type { EventSink } from "../events/event-sink";
import { generateIntent, intentToPayload } from "../intents";
import type { BuffId } from "../registry/ids";
import { enemyConditionContext } from "./resolve";
import { applyBuffToTarget, dealDamage, gainBlock, PLAYER_ID } from "./resolve";
import type { Draft } from "./draft";

/** 为每个存活敌人抽取下回合意图并揭示。 */
export function generateIntents(draft: Draft, sink: EventSink): void {
  for (const enemy of draft.enemies) {
    if (enemy.hp <= 0) continue;
    const def = draft.content.enemies.get(enemy.id);
    if (!def) {
      const intent = intentToPayload({ kind: "unknown" });
      enemy.intent = intent;
      sink.emit("IntentRevealed", { enemyId: enemy.id, intent });
      continue;
    }
    const roll = generateIntent(def, enemyConditionContext(draft, enemy.id), enemy.intentHistory, draft.rng.stream("combat"));
    enemy.intent = roll.intent;
    enemy.intentHistory = [...enemy.intentHistory, roll.key];
    sink.emit("IntentRevealed", { enemyId: enemy.id, intent: roll.intent });
  }
}

/** 执行敌人当前意图（enemyAction 相位）。 */
export function runEnemyTurn(draft: Draft, sink: EventSink): void {
  for (const enemy of draft.enemies) {
    if (enemy.hp <= 0) continue;
    const intent = enemy.intent;
    if (!intent) continue;

    switch (intent.kind) {
      case "attack": {
        const hits = Math.max(1, intent.hits ?? 1);
        for (let i = 0; i < hits; i += 1) {
          dealDamage(draft, sink, {
            sourceId: enemy.id,
            actorId: enemy.id,
            targetId: PLAYER_ID,
            base: intent.value ?? 0,
            segment: i + 1,
            segments: hits,
          });
        }
        break;
      }
      case "defend":
        gainBlock(draft, sink, enemy.id, intent.value ?? 0);
        break;
      case "debuff":
        if (intent.buffId) {
          applyBuffToTarget(draft, sink, PLAYER_ID, intent.buffId as BuffId, intent.stacks ?? 1, intent.duration);
        }
        break;
      case "charge":
        applyBuffToTarget(draft, sink, enemy.id, "strength", intent.value ?? 1, null);
        break;
      default:
        break;
    }
  }
}
