// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { createContentDb } from "@/core/registry";
import { getRelicHandler } from "@/core/registry/relic-handler";
import { loadGameContent } from "@/data/load";
import { TEST_CARDS, TEST_ENEMIES } from "../helpers/combat";

const game = loadGameContent();
const dataRelics = game.content.relics;

function contentWith(relicIds: readonly string[]) {
  return createContentDb({
    cards: new Map(TEST_CARDS.map((c) => [c.id, c])),
    enemies: new Map(TEST_ENEMIES.map((e) => [e.id, e])),
    enhancements: new Map(),
    relics: new Map(relicIds.map((id) => [id, dataRelics.get(id)!])),
  });
}

function battle(relicIds: readonly string[], seed = 11) {
  return reduce(
    createBattleState({
      battleId: "t",
      seed,
      player: { maxHp: 66, energy: 3 },
      enemies: [{ id: "dummy" }],
      deck: ["strike", "strike", "strike", "strike", "strike"],
      handSize: 5,
      relics: [...relicIds],
      content: contentWith(relicIds),
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

/** docs/65 §6.3 备选遗物两件入池（docs/66 §七.6「捆」）。 */
describe("批 3 · 备选遗物两件", () => {
  it("两件都已入池：淬火怀表 T3 / 赌徒齿轮 T2", () => {
    expect(dataRelics.get("quench_watch")?.tier).toBe(3);
    expect(dataRelics.get("quench_watch")?.handler).toBe("first_hit_strength");
    expect(dataRelics.get("quench_watch")?.once).toBe("battle");
    expect(dataRelics.get("loaded_gear")?.tier).toBe(2);
    expect(dataRelics.get("loaded_gear")?.effects?.[0]?.kind).toBe("chance");
  });

  it("淬火怀表 handler：首次受击给 2 层力量（数值走 params）", () => {
    const handler = getRelicHandler("first_hit_strength");
    const ctx = {
      hp: 60,
      maxHp: 66,
      pollution: 0,
      charge: 0,
      block: 0,
      buffs: [],
      cardsPlayedThisTurn: 0,
      attackCardsPlayedThisTurn: 0,
      energySpentThisTurn: 0,
      handSize: 5,
      turn: 2,
      firesThisTurn: 0,
    };
    expect(handler.onDamaged!({ stacks: 2 }, ctx)).toEqual([
      { kind: "applyBuff", target: { type: "self" }, buff: "strength", stacks: 2 },
    ]);
    expect(handler.onDamaged!({ stacks: 0 }, ctx)).toEqual([]);
  });

  it("赌徒齿轮：战斗开始时按 chance 恰好结算一条分支，且同种子同结果", () => {
    const a = battle(["loaded_gear"], 11);
    const b = battle(["loaded_gear"], 11);
    expect(b.player.energy === a.player.energy && b.player.pollution === a.player.pollution).toBe(true);
    const energyHit = a.player.energy === 3 + 3 && a.player.pollution === 0;
    const polluteHit = a.player.energy === 3 && a.player.pollution === 8;
    expect(energyHit || polluteHit, `两条分支必须命中其一（energy=${a.player.energy} pollution=${a.player.pollution}）`).toBe(true);
  });

  it("不带赌徒齿轮时不发生任何战斗开始随机", () => {
    const s = battle([], 11);
    expect(s.player.energy).toBe(3);
    expect(s.player.pollution).toBe(0);
  });
});
