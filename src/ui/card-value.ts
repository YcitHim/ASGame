/**
 * ui/card-value · 卡面派生数值（docs/41 §4.2）
 *
 * 只做"给玩家看"的算术，不参与任何结算：结算永远以 core 的事件流为准。
 * 第一个用途是卖血牌净值行——玩家看到「血契 2 / 回 6」两行会以为是 bug。
 */
import type { CardDefinition } from "@/core/registry";
import { loadGameContent } from "@/data/load";

/** 该牌的自我回复量（heal 且目标是自己；无 target 时 core 默认也是自己）。 */
function selfHeal(def: CardDefinition, upgraded: boolean): number {
  const effects = (upgraded ? def.upgraded?.effects : undefined) ?? def.effects ?? [];
  return effects
    .filter((e) => e.kind === "heal")
    .filter((e) => e.target === undefined || e.target.type === "self")
    .reduce((sum, e) => sum + (e.value ?? 0), 0);
}

/**
 * 卖血牌的 HP 净值 = 回复 − 血契代价（docs/41 §4.2）。
 * 只有"同时失去与回复"的牌才有净值行；纯代价牌 / 纯回复牌返回 null。
 */
export function netHpChange(cardId: string, upgraded = false): number | null {
  const def = loadGameContent().content.cards.get(cardId);
  if (!def) return null;
  const blood = def.bloodCost ?? 0;
  if (blood <= 0) return null;
  const heal = selfHeal(def, upgraded);
  if (heal <= 0) return null;
  return heal - blood;
}

/** 净值行文案：净 +4 HP / 净 −2 HP；无净值行则空串。 */
export function netHpText(cardId: string, upgraded = false): string {
  const net = netHpChange(cardId, upgraded);
  if (net === null) return "";
  return `净 ${net >= 0 ? "+" : "−"}${Math.abs(net)} HP`;
}
