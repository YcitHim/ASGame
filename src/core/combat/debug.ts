/**
 * core/combat/debug · 调试指令（G4，仅调试构建注入）
 *
 * 指令：noop / set hp <n> / set energy <n> / add buff <id> <stacks> [duration]
 *       / give card <id> / draw <n> / kill <enemyId> / seed <n>
 *       / intent <enemyId> attack <value>
 *       / intent <enemyId> debuff <buffId> <stacks>
 *       / intent <enemyId> charge <value> <block> <release>
 * 约定：所有 bug 复现步骤用这些指令描述。
 */
import type { IntentPayload } from "../events";
import type { BuffId } from "../registry/ids";
import { Rng } from "../rng";
import type { EventSink } from "../events/event-sink";
import { applyBuffToTarget, drawCards, killUnit, PLAYER_ID } from "./resolve";
import { findUnit, type Draft } from "./draft";

export interface DebugResult {
  readonly ok: boolean;
  readonly message: string;
}

function int(token: string | undefined): number | null {
  if (token === undefined) return null;
  const n = Number(token);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function executeDebugCommand(draft: Draft, sink: EventSink, command: string): DebugResult {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const head = tokens[0] ?? "";

  switch (head) {
    case "noop":
      return { ok: true, message: "noop" };

    case "set": {
      const what = tokens[1];
      const value = int(tokens[2]);
      if (value === null) return { ok: false, message: "用法：set hp|energy <n>" };
      if (what === "hp") {
        draft.player.hp = Math.max(0, Math.min(draft.player.maxHp, value));
        return { ok: true, message: `HP = ${draft.player.hp}` };
      }
      if (what === "energy") {
        draft.player.energy = Math.max(0, value);
        return { ok: true, message: `能量 = ${draft.player.energy}` };
      }
      return { ok: false, message: `未知字段 "${what}"` };
    }

    case "add": {
      if (tokens[1] !== "buff") return { ok: false, message: "用法：add buff <id> <stacks> [duration]" };
      const id = tokens[2] as BuffId | undefined;
      const stacks = int(tokens[3]);
      if (!id || stacks === null) return { ok: false, message: "用法：add buff <id> <stacks> [duration]" };
      const duration = tokens[4] === undefined ? undefined : int(tokens[4]);
      applyBuffToTarget(draft, sink, PLAYER_ID, id, stacks, duration);
      return { ok: true, message: `已施加 ${id} ×${stacks}` };
    }

    case "give": {
      if (tokens[1] !== "card" || !tokens[2]) return { ok: false, message: "用法：give card <id>" };
      const cardId = tokens[2];
      if (!draft.content.cards.has(cardId)) return { ok: false, message: `卡牌未注册：${cardId}` };
      const index = Object.keys(draft.cardInstances).length + 1;
      const instanceId = `${cardId}#dbg${index}`;
      draft.cardInstances[instanceId] = { instanceId, cardId, upgraded: false, enhancements: [] };
      draft.hand.push(instanceId);
      return { ok: true, message: `已加入手牌：${cardId}` };
    }

    case "draw": {
      const n = int(tokens[1]);
      if (n === null || n < 0) return { ok: false, message: "用法：draw <n>" };
      drawCards(draft, sink, n);
      return { ok: true, message: `抽 ${n} 张` };
    }

    case "kill": {
      const id = tokens[1];
      const unit = id ? findUnit(draft, id) : undefined;
      if (!id || !unit) return { ok: false, message: `敌人不存在：${id ?? ""}` };
      unit.hp = 0;
      killUnit(draft, sink, id);
      return { ok: true, message: `已击杀 ${id}` };
    }

    /**
     * 钉死某只敌人的当前意图（教学脚本用，docs/42 速成版）：
     * 不走 RNG 抽取，直接改 combat 状态；`charge` 会自动把释放段排进 forcedChain。
     * 这让教学能稳定地演「1 回合蓄力」而不用靠种子碰运气。
     */
    case "intent": {
      const id = tokens[1];
      const kind = tokens[2];
      const enemy = id ? draft.enemies.find((e) => e.id === id) : undefined;
      if (!enemy || !kind) {
        return { ok: false, message: "用法：intent <enemyId> attack|debuff|charge …" };
      }
      let payload: IntentPayload;
      if (kind === "charge") {
        const value = int(tokens[3]) ?? 0;
        const block = int(tokens[4]) ?? 0;
        const release = int(tokens[5]) ?? value + 6;
        // 释放段交给 forcedChain：下一回合敌人行动完就会自动揭示，无需再钉
        enemy.forcedChain = [{ kind: "attack", value: release, released: true }];
        payload = { kind: "charge", value, block, thenValue: release, thenIn: 1 };
      } else if (kind === "debuff") {
        const buffId = (tokens[3] ?? "weak") as BuffId;
        const stacks = int(tokens[4]) ?? 1;
        enemy.forcedChain = [];
        payload = { kind: "debuff", buffId, stacks };
      } else if (kind === "attack") {
        enemy.forcedChain = [];
        payload = { kind: "attack", value: int(tokens[3]) ?? 0 };
      } else {
        enemy.forcedChain = [];
        payload = { kind: "defend", value: int(tokens[3]) ?? 0 };
      }
      enemy.intent = payload;
      sink.emit("IntentRevealed", { enemyId: enemy.id, intent: payload });
      return { ok: true, message: `${enemy.id} 的意图已钉为 ${kind}` };
    }

    case "seed": {
      const n = int(tokens[1]);
      if (n === null) return { ok: false, message: "用法：seed <n>" };
      draft.rootSeed = n >>> 0;
      draft.rng = new Rng(draft.rootSeed);
      return { ok: true, message: `种子 = ${draft.rootSeed}` };
    }

    default:
      return { ok: false, message: `未知指令 "${head}"` };
  }
}
