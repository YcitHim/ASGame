import { describe, expect, it } from "vitest";
import { reduce } from "@/core/combat";
import { startState, testConfig } from "../helpers/combat";

const debug = (state: ReturnType<typeof startState>, command: string) =>
  reduce(state, { type: "DebugCommand", actionId: `d:${command}`, command });

describe("S3.6 调试控制台指令（G4）", () => {
  const started = () => startState(testConfig());

  it("set hp / set energy", () => {
    const hp = debug(started(), "set hp 30").state;
    expect(hp.player.hp).toBe(30);
    const energy = debug(hp, "set energy 7").state;
    expect(energy.player.energy).toBe(7);
    expect(debug(energy, "set hp 999").state.player.hp).toBe(66);
  });

  it("add buff 与 duration", () => {
    const state = debug(started(), "add buff strength 3").state;
    expect(state.player.buffs.find((b) => b.id === "strength")?.stacks).toBe(3);
    const timed = debug(state, "add buff vulnerable 1 3").state;
    expect(timed.player.buffs.find((b) => b.id === "vulnerable")?.duration).toBe(3);
  });

  it("give card：注册卡才可加入，未注册报错", () => {
    const before = started();
    const strikeCount = (state: typeof before) =>
      state.piles.hand.filter((id) => state.cardInstances[id].cardId === "strike").length;
    const state = debug(before, "give card strike").state;
    expect(strikeCount(state)).toBe(strikeCount(before) + 1);
    expect(state.piles.hand).toHaveLength(before.piles.hand.length + 1);

    const bad = debug(state, "give card not_a_card");
    expect(bad.state.piles.hand).toHaveLength(state.piles.hand.length);
  });

  it("draw / kill / seed", () => {
    const state = debug(started(), "draw 2").state;
    expect(state.piles.hand.length).toBeGreaterThanOrEqual(5);

    const killed = debug(started(), "kill dummy").state;
    expect(killed.enemies[0].hp).toBe(0);
    expect(killed.phase).toBe("battleEnd");

    const res = debug(started(), "seed 12345");
    expect(res.state.rootSeed).toBe(12345);
  });

  it("未知指令不改状态", () => {
    const before = started();
    const after = debug(before, "dance now").state;
    expect(after.player.hp).toBe(before.player.hp);
    expect(after.piles.hand).toHaveLength(before.piles.hand.length);
  });
});
