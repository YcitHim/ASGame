/**
 * ui/card-value · 卡面派生数值（docs/41 §4.2）
 *
 * 只做"给玩家看"的算术，不参与任何结算：结算永远以 core 的事件流为准。
 * 第一个用途是卖血牌净值行——玩家看到「血契 2 / 回 6」两行会以为是 bug。
 */
import type { CardDefinition } from "@/core/registry";
import { loadGameContent } from "@/data/load";

/** 该牌的即时自我回复量（heal 且目标是自己；无 target 时 core 默认也是自己）。 */
function selfHeal(def: CardDefinition, upgraded: boolean): number {
  const effects = (upgraded ? def.upgraded?.effects : undefined) ?? def.effects ?? [];
  return effects
    .filter((e) => e.kind === "heal")
    .filter((e) => e.target === undefined || e.target.type === "self")
    .reduce((sum, e) => sum + (e.value ?? 0), 0);
}

/** 该牌的延迟回血（回血印记，调血）：层数就是下回合回的血量。 */
function selfMending(def: CardDefinition, upgraded: boolean): number {
  const effects = (upgraded ? def.upgraded?.effects : undefined) ?? def.effects ?? [];
  return effects
    .filter((e) => e.kind === "applyBuff" && e.buff === "mending")
    .filter((e) => e.target === undefined || e.target.type === "self")
    .reduce((sum, e) => sum + (e.stacks ?? 0), 0);
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
  const heal = selfHeal(def, upgraded) + selfMending(def, upgraded);
  if (heal <= 0) return null;
  return heal - blood;
}

/**
 * 这份净值是不是"下回合才到账"（调血走的是回血印记）。
 * 牌面必须写出来，否则玩家会以为打完立刻回血。
 */
export function netHpDelayed(cardId: string, upgraded = false): boolean {
  const def = loadGameContent().content.cards.get(cardId);
  if (!def) return false;
  return selfMending(def, upgraded) > 0 && selfHeal(def, upgraded) === 0;
}

/** 净值行文案：净 +4 HP / 净 +2 HP（下回合）；无净值行则空串。 */
export function netHpText(cardId: string, upgraded = false): string {
  const net = netHpChange(cardId, upgraded);
  if (net === null) return "";
  const when = netHpDelayed(cardId, upgraded) ? "（下回合）" : "";
  return `净 ${net >= 0 ? "+" : "−"}${Math.abs(net)} HP${when}`;
}
