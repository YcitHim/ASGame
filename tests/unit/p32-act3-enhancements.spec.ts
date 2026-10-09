import { describe, expect, it } from "vitest";
import { getEnhancementHandler } from "@/core/registry/enhancement-handler";
import { loadGameContent } from "@/data/load";

const game = loadGameContent();
const ctx = {
  hp: 70,
  maxHp: 70,
  pollution: 0,
  charge: 0,
  buffs: [],
  cardsPlayedThisTurn: 1,
  handSize: 5,
  hitIndex: 0,
};
const params = (id: string) => game.content.enhancements.get(id)!.params;
const cardDef = (id: string) => game.content.cards.get(id)!;
const effectsOf = (id: string) => cardDef(id).effects ?? [];

/** docs/66 批 3 · 第三幕「锈心锻炉」专属强化（actScope: act3）。 */
describe("批 3 · 第三幕专属强化 ×3", () => {
  it("三枚都入内容库并绑定 act3", () => {
    for (const id of ["forgeheart", "slagplate", "emberdraw"]) {
      const enh = game.content.enhancements.get(id);
      expect(enh, id).toBeTruthy();
      expect(enh!.actScope, id).toBe("act3");
      expect(enh!.tier, id).toBe(1);
      expect(enh!.appliesTo.length, id).toBeGreaterThan(0);
    }
  });

  it("炉心余温：普通伤害牌 +2；释放充能的牌 +4（口径 = spendCharge，不是 chargeCost）", () => {
    const handler = getEnhancementHandler("forgeheart");
    const normal = handler.modifyCard!(
      { def: cardDef("strike"), effects: effectsOf("strike") },
      params("forgeheart"),
      ctx,
    );
    expect(normal?.modifiers).toEqual([{ kind: "attackDamage", op: "add", value: 2 }]);

    // 找一张真的带 spendCharge 的牌（口径锚点）
    const release = [...game.content.cards.values()].find((c) => (c.effects ?? []).some((e) => e.kind === "spendCharge"));
    expect(release, "内容库里应存在 spendCharge 牌").toBeTruthy();
    const result = handler.modifyCard!(
      { def: release!, effects: release!.effects ?? [] },
      params("forgeheart"),
      ctx,
    );
    expect(result?.modifiers).toEqual([{ kind: "attackDamage", op: "add", value: 4 }]);
  });

  it("炉渣镀层：格挡 +3，并注入「本回合首次获得格挡再 +1」的常驻能力", () => {
    const handler = getEnhancementHandler("slagplate");
    const result = handler.modifyCard!(
      { def: cardDef("brassguard"), effects: effectsOf("brassguard") },
      params("slagplate"),
      ctx,
    );
    expect(result?.modifiers).toEqual([{ kind: "block", op: "add", value: 3 }]);
    expect(handler.power!(params("slagplate"))).toEqual({
      timing: "onBlock",
      once: "turn",
      effects: [{ kind: "block", target: { type: "self" }, value: 1 }],
    });
  });

  it("余烬引线：费用 −1，并注入「打出消耗牌时抽 1（每回合一次）」的常驻能力", () => {
    const handler = getEnhancementHandler("emberdraw");
    const result = handler.modifyCard!(
      { def: cardDef("exsanguinate"), effects: effectsOf("exsanguinate") },
      params("emberdraw"),
      ctx,
    );
    expect(result?.modifiers).toEqual([{ kind: "cardCost", op: "add", value: -1 }]);
    expect(handler.power!(params("emberdraw"))).toEqual({
      timing: "onExhaust",
      once: "turn",
      effects: [{ kind: "draw", value: 1 }],
    });
  });
});
