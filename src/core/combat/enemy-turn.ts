/**
 * core/combat/enemy-turn · 敌人行动：意图生成（intents/）与执行
 */
import type { IntentPayload } from "../events";
import type { EventSink } from "../events/event-sink";
import { generateIntent } from "../intents";
import type { BuffId } from "../registry/ids";
import { enemyConditionContext } from "./resolve";
import {
  applyBuffToTarget,
  dealDamage,
  gainBlock,
  PLAYER_ID,
  resolveCorroding,
  summonUnit,
  MAX_FIELD_ENEMIES,
} from "./resolve";
import type { Draft } from "./draft";
import type { SummonContext } from "../intents";

function summonContext(draft: Draft): SummonContext {
  const alive = draft.enemies.filter((e) => e.hp > 0);
  return {
    fieldCount: alive.length,
    maxField: MAX_FIELD_ENEMIES,
    aliveDefIds: alive.map((e) => e.defId),
  };
}

/** 为每个存活敌人抽取下回合意图并揭示。 */
export function generateIntents(draft: Draft, sink: EventSink): void {
  for (const enemy of draft.enemies) {
    if (enemy.hp <= 0) continue;

    // 蓄力链：上一环指定的后续直接揭示，不再随机
    const queued = enemy.forcedChain.shift();
    if (queued) {
      enemy.intent = queued;
      sink.emit("IntentRevealed", { enemyId: enemy.id, intent: queued });
      continue;
    }

    const def = draft.content.enemies.get(enemy.defId);
    if (!def) {
      const intent: IntentPayload = { kind: "unknown" };
      enemy.intent = intent;
      sink.emit("IntentRevealed", { enemyId: enemy.id, intent });
      continue;
    }
    const roll = generateIntent(
      def,
      enemyConditionContext(draft, enemy.id),
      enemy.intentHistory,
      draft.rng.stream("combat"),
      summonContext(draft),
    );
    enemy.intent = roll.intent;
    enemy.intentHistory = [...enemy.intentHistory, roll.key];
    enemy.forcedChain = roll.chain ? [...roll.chain] : [];
    sink.emit("IntentRevealed", { enemyId: enemy.id, intent: roll.intent });
  }
}

/** 执行敌人当前意图（enemyAction 相位）。 */
export function runEnemyTurn(draft: Draft, sink: EventSink): void {
  // 快照行动者：本回合新召唤的单位不会立刻行动（docs/40 §五-4）
  const acting = [...draft.enemies];
  for (const enemy of acting) {
    if (enemy.hp <= 0) continue;
    if (enemy.spawnedTurn === draft.turn) continue;
    const intent = enemy.intent;
    if (!intent) continue;

    switch (intent.kind) {
      case "attack": {
        if (intent.released) {
          sink.emit("ChargeResolved", {
            enemyId: enemy.id,
            block: 0,
            released: true,
            value: intent.value ?? 0,
          });
        }
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
      case "charge": {
        // 蓄力 = 预告回合：架起格挡（docs/18 Q3），不施加永久力量（docs/16 禁止）。
        // 释放值已由蓄力链算死在末端攻击上，此处不记账。
        const chargeBlock = intent.block ?? 0;
        sink.emit("ChargeResolved", { enemyId: enemy.id, block: chargeBlock, released: false });
        if (chargeBlock > 0) gainBlock(draft, sink, enemy.id, chargeBlock);
        break;
      }
      case "summon": {
        // 召唤（docs/40 §五）：满员不再召唤；新单位入场当回合不行动
        if (intent.enemyId) summonUnit(draft, sink, enemy.id, intent.enemyId, intent.count ?? 1);
        break;
      }
      default:
        break;
    }
  }
  // 敌方回合结束：结算蚀锈 DoT（docs/38 §二 B-2）
  resolveCorroding(draft, sink);
}
