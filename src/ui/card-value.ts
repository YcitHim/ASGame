/**
 * ui/card-value · 卡面派生数值（docs/41 §4.2）
 *
 * 只做"给玩家看"的算术，不参与任何结算：结算永远以 core 的事件流为准。
 *
 * 净值行的适用范围**只限「同一次出牌里先扣血、又立刻回血」的牌**——
 * 那种情况下玩家会看到「-2 然后 +6」两跳飘字，以为出了 bug。
 * 延迟到账的回血（调血 → 回血印记）不在此列：它和代价本来就隔了一个回合，
 * 不存在"两跳打架"，再标一行小字只是给卡面添噪音（甲方反馈：难看）。
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

/**
 * 卖血牌的 HP 净值 = 即时回复 − 血契代价（docs/41 §4.2）。
 * 只有"同一次出牌里既失去又回复"的牌才有净值行；其余一律返回 null。
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

/** 净值行文案：净 +4 HP / 净 −2 HP；不该有净值行时返回空串。 */
export function netHpText(cardId: string, upgraded = false): string {
  const net = netHpChange(cardId, upgraded);
  if (net === null) return "";
  return `净 ${net >= 0 ? "+" : "−"}${Math.abs(net)} HP`;
}
