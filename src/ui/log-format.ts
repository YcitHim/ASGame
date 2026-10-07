/**
 * ui/log-format · 战斗日志的面板文本（G4）
 *
 * DamageDealt 必须展开修饰层明细——数值 bug 全靠这里定位。
 */
import type { DomainEvent } from "@/core/events";

export interface LogEntry {
  readonly seq: number;
  readonly type: string;
  readonly text: string;
  readonly detail?: string;
}

function unitLabel(id: string, names: Record<string, string>): string {
  return id === "player" ? "你" : (names[id] ?? id);
}

/** HpLost.reason → 面板中文标签（docs/58 §六 新增 overload）。 */
const HP_LOST_REASON: Record<string, string> = {
  damage: "受击",
  bloodpact: "血契",
  pollution: "污染",
  backlash: "反噬",
  burn: "灼烧",
  overload: "超负荷",
};

export function describeEvent(event: DomainEvent, names: Record<string, string> = {}): LogEntry {
  switch (event.type) {
    case "BattleStarted":
      return { seq: event.seq, type: event.type, text: `战斗开始 · 敌人 ${event.enemies.map((e) => names[e.id] ?? e.id).join("、")}` };
    case "TurnStarted":
      return { seq: event.seq, type: event.type, text: `—— 回合 ${event.turn} 开始 ——` };
    case "TurnEnded":
      return { seq: event.seq, type: event.type, text: `回合 ${event.turn} 结束` };
    case "CardsDrawn":
      return { seq: event.seq, type: event.type, text: `抽牌 ${event.cardIds.length} 张` };
    case "DeckShuffled":
      return { seq: event.seq, type: event.type, text: `洗牌：弃牌堆 ${event.count} 张回抽牌堆` };
    case "CardPlayed":
      return {
        seq: event.seq,
        type: event.type,
        text: `打出 ${event.cardId}（费 ${event.costPaid}${event.bloodPaid ? ` · 血 ${event.bloodPaid}` : ""}）`,
      };
    case "DamageDealt": {
      const layers = event.layers
        .map((l) => `${l.sourceId} ${l.op === "mul" ? "×" : "+"}${l.value} (${l.before}→${l.after})`)
        .join("  ");
      return {
        seq: event.seq,
        type: event.type,
        text: `${unitLabel(event.sourceId, names)} → ${unitLabel(event.targetId, names)} ${event.value} 伤害${event.segments > 1 ? `（第 ${event.segment}/${event.segments} 段）` : ""}`,
        detail: `基础 ${event.base}${layers ? " | " + layers : ""} | 格挡 ${event.blocked} | HP ${event.hpLost}`,
      };
    }
    case "BlockGained":
      return { seq: event.seq, type: event.type, text: `${unitLabel(event.targetId, names)} 获得 ${event.value} 格挡（共 ${event.total}）` };
    case "BlockBroken":
      return { seq: event.seq, type: event.type, text: `${unitLabel(event.targetId, names)} 格挡被击破` };
    case "HpLost":
      return { seq: event.seq, type: event.type, text: `${unitLabel(event.targetId, names)} 失去 ${event.value} HP（${HP_LOST_REASON[event.reason] ?? event.reason}）` };
    case "HpHealed":
      return { seq: event.seq, type: event.type, text: `${unitLabel(event.targetId, names)} 回复 ${event.value} HP（${event.reason}）` };
    case "BuffApplied":
      return { seq: event.seq, type: event.type, text: `${unitLabel(event.targetId, names)} 获得 ${event.buffId} ×${event.stacks}` };
    case "BuffTriggered":
      return { seq: event.seq, type: event.type, text: `${unitLabel(event.targetId, names)} ${event.buffId} 触发` };
    case "BuffExpired":
      return { seq: event.seq, type: event.type, text: `${unitLabel(event.targetId, names)} ${event.buffId} 结束` };
    case "BuffTicked":
      return {
        seq: event.seq,
        type: event.type,
        text: `${unitLabel(event.targetId, names)} 蚀锈发作，受到 ${event.damage} 点伤害`,
      };
    case "PollutionChanged":
      return { seq: event.seq, type: event.type, text: `污染 ${event.before} → ${event.after}${event.critical ? "（临界）" : ""}` };
    case "ChargeChanged":
      return { seq: event.seq, type: event.type, text: `充能 ${event.before} → ${event.after}` };
    case "Overloaded":
      return { seq: event.seq, type: event.type, text: `过载！充能 ${event.charge}，反噬 ${event.backlash}` };
    case "ChargeInterrupted":
      return {
        seq: event.seq,
        type: event.type,
        text: `${unitLabel(event.enemyId, names)}的蓄力被打断了！`,
      };
    case "ChargeResolved":
      return {
        seq: event.seq,
        type: event.type,
        text: event.released
          ? `${unitLabel(event.enemyId, names)} 释放了蓄力重击！`
          : `${unitLabel(event.enemyId, names)} 开始蓄力${event.block > 0 ? `（架起 ${event.block} 点格挡）` : ""}`,
      };
    case "IntentRevealed": {
      const intent = event.intent;
      const who = unitLabel(event.enemyId, names);
      if (intent.kind === "charge") {
        const parts: string[] = [];
        if (intent.block) parts.push(`架起 ${intent.block} 点格挡`);
        if (intent.thenValue !== undefined) {
          const when = (intent.thenIn ?? 1) > 1 ? `${intent.thenIn} 回合后` : "下回合";
          parts.push(`${when}释放 ${intent.thenValue} 点重击`);
        }
        return { seq: event.seq, type: event.type, text: `${who} 开始蓄力（${parts.join("，")}）` };
      }
      if (intent.released) {
        return { seq: event.seq, type: event.type, text: `${who} 蓄力重击已就绪（${intent.value ?? 0} 点）` };
      }
      return { seq: event.seq, type: event.type, text: `${who} 意图：${intent.kind}${intent.value !== undefined ? " " + intent.value : ""}` };
    }
    case "UnitDied":
      return { seq: event.seq, type: event.type, text: `${unitLabel(event.unitId, names)} 倒下` };
    case "BattleEnded":
      return { seq: event.seq, type: event.type, text: event.result === "win" ? "战斗胜利" : "战斗失败" };
    case "CardExhausted":
      return { seq: event.seq, type: event.type, text: `${event.cardId} 被消耗` };
    case "CardRetained":
      return { seq: event.seq, type: event.type, text: `${event.cardId} 保留` };
    default: {
      const fallback = event as DomainEvent;
      return { seq: fallback.seq, type: fallback.type, text: fallback.type };
    }
  }
}
