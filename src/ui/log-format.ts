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
      return { seq: event.seq, type: event.type, text: `${unitLabel(event.targetId, names)} 失去 ${event.value} HP（${event.reason}）` };
    case "HpHealed":
      return { seq: event.seq, type: event.type, text: `${unitLabel(event.targetId, names)} 回复 ${event.value} HP（${event.reason}）` };
    case "BuffApplied":
      return { seq: event.seq, type: event.type, text: `${unitLabel(event.targetId, names)} 获得 ${event.buffId} ×${event.stacks}` };
    case "BuffTriggered":
      return { seq: event.seq, type: event.type, text: `${unitLabel(event.targetId, names)} ${event.buffId} 触发` };
    case "BuffExpired":
      return { seq: event.seq, type: event.type, text: `${unitLabel(event.targetId, names)} ${event.buffId} 结束` };
    case "PollutionChanged":
      return { seq: event.seq, type: event.type, text: `污染 ${event.before} → ${event.after}${event.critical ? "（临界）" : ""}` };
    case "ChargeChanged":
      return { seq: event.seq, type: event.type, text: `充能 ${event.before} → ${event.after}` };
    case "Overloaded":
      return { seq: event.seq, type: event.type, text: `过载！充能 ${event.charge}，反噬 ${event.backlash}` };
    case "IntentRevealed":
      return { seq: event.seq, type: event.type, text: `${unitLabel(event.enemyId, names)} 意图：${event.intent.kind}${event.intent.value !== undefined ? " " + event.intent.value : ""}` };
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
