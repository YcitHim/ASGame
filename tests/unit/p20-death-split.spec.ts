import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { loadGameContent } from "@/data/load";
import { buffStacks } from "@/core/buffs";

/**
 * docs/47 §三.4 / §四.2 §五 · M3 分裂亡语：
 * 死亡原地召唤 enemyId × N，沿用召唤规则（入场当回合不行动），**分裂物不再分裂**。
 */
const game = loadGameContent();

function start(enemyIds: string[], deck: string[] = ["big", "big", "big", "big", "big"]) {
  return reduce(
    createBattleState({
      battleId: "split",
      seed: 4,
      player: { maxHp: 66, energy: 3 },
      enemies: enemyIds.map((id) => ({ id })),
      deck,
      handSize: 5,
      content: game.content,
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

describe("docs/47 M3 · 分裂亡语", () => {
  it("鼓腹兽死亡后场上多出 2 只 rust_leech，且它们当回合不行动", () => {
    const state = start(["blister_belly"]);
    // 直接把它打死（用 core 的 debug 指令，走正常死亡清理）
    const killed = reduce(state, { type: "DebugCommand", actionId: "k", command: "kill blister_belly" }).state;
    const leeches = killed.enemies.filter((e) => e.defId === "rust_leech");
    expect(leeches).toHaveLength(2);
    for (const leech of leeches) {
      expect(leech.spawnedTurn).toBe(killed.turn); // 入场当回合标记
      expect(leech.hp).toBe(15);
    }
    // 分裂物自身没有 onDeathSplit → 不会再分裂
    expect(game.content.enemies.get("rust_leech")?.onDeathSplit).toBeUndefined();
  });

  it("藤壶寄居者：死亡分裂出 2 只汛虫（act2 池 B/C）", () => {
    const state = start(["barnacle_host"]);
    const killed = reduce(state, { type: "DebugCommand", actionId: "k", command: "kill barnacle_host" }).state;
    expect(killed.enemies.filter((e) => e.defId === "tide_mite")).toHaveLength(2);
  });

  it("藤壶硬壳：签名技是「壳击」（自己上荆棘 1） + 加固外壳（坚韧 2，docs/60 §五）", () => {
    const def = game.content.enemies.get("barnacle_host")!;
    const selfBuffs = def.intents.filter((e) => e.intent.kind === "selfBuff");
    expect(selfBuffs.some((e) => e.intent.buffId === "bramble" && e.intent.stacks === 1)).toBe(true);
    expect(selfBuffs.some((e) => e.intent.buffId === "tenacity" && e.intent.stacks === 2)).toBe(true);
    // 挂在意图上是「要花一回合去加固」，不是开场白给
    expect(def.startBuffs).toBeUndefined();
    expect(buffStacks(start(["barnacle_host"]).enemies[0]!.buffs, "tenacity")).toBe(0);
  });

  it("数值与设计表一致（docs/60 §二 修订值）", () => {
    const def = (id: string) => game.content.enemies.get(id)!;
    expect(def("blister_belly").maxHp).toBe(48);
    expect(def("blister_belly").onDeathSplit).toEqual({ enemyId: "rust_leech", count: 2 });
    expect(def("rust_leech").maxHp).toBe(15);
    expect(def("rust_leech").intents[0]!.intent).toMatchObject({ kind: "attack", value: 3 });
    expect(def("barnacle_host").maxHp).toBe(58);
    expect(def("barnacle_host").onDeathSplit).toEqual({ enemyId: "tide_mite", count: 2 });
  });
});
