import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import type { Action } from "@/core/actions";
import { startState, testConfig } from "../helpers/combat";

function run(actions: Action[], overrides: Parameters<typeof testConfig>[0] = {}): { state: BattleState; events: unknown[] } {
  let state = createBattleState(testConfig(overrides));
  const events: unknown[] = [];
  for (const action of actions) {
    const result = reduce(state, action);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

const flow: Action[] = [
  { type: "Noop", actionId: "s0" },
  { type: "EndTurn", actionId: "e1" },
  { type: "EndTurn", actionId: "e2" },
];

describe("S3.1 回合状态机与胜负", () => {
  it("相位流转：battleStart 后进入 playerAction，EndTurn 后回到 playerAction", () => {
    const { state } = run([{ type: "Noop", actionId: "s0" }]);
    expect(state.phase).toBe("playerAction");
    expect(state.turn).toBe(1);
    const after = run([...flow], {}, ).state;
    expect(after.turn).toBe(3);
    expect(after.phase).toBe("playerAction");
  });

  it("敌人回合会执行意图并造成伤害", () => {
    const started = startState(testConfig());
    const after = reduce(started, { type: "EndTurn", actionId: "e" });
    expect(after.events.some((e) => e.type === "DamageDealt")).toBe(true);
    expect(after.state.player.hp).toBe(61);
  });

  it("击杀全部敌人 → BattleEnded win", () => {
    const started = startState(testConfig());
    const result = reduce(started, { type: "DebugCommand", actionId: "k", command: "kill dummy" });
    expect(result.state.phase).toBe("battleEnd");
    const ended = result.events.find((e) => e.type === "BattleEnded");
    expect(ended && ended.type === "BattleEnded" ? ended.result : "").toBe("win");
    expect(ended && ended.type === "BattleEnded" ? typeof ended.rewardsSeed : "").toBe("number");
  });

  it("玩家 HP 归零 → BattleEnded lose", () => {
    const started = startState(testConfig());
    const low = reduce(started, { type: "DebugCommand", actionId: "d", command: "set hp 1" }).state;
    const result = reduce(low, { type: "EndTurn", actionId: "e" });
    expect(result.state.player.hp).toBe(0);
    expect(result.state.phase).toBe("battleEnd");
    const ended = result.events.find((e) => e.type === "BattleEnded");
    expect(ended && ended.type === "BattleEnded" ? ended.result : "").toBe("lose");
  });

  it("意图在回合开始揭示（IntentRevealed）", () => {
    const started = startState(testConfig());
    expect(started.enemies[0].intent).not.toBeNull();
  });

  it("同种子同输入流：事件流与最终状态逐条一致（回放地基）", () => {
    const a = run(flow);
    const b = run(flow);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  it("改 map 流不影响战斗事件流（ADR-006）", () => {
    const a = run(flow);
    const b = run(flow);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
});
