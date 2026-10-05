import { describe, expect, it } from "vitest";
import { reduce } from "@/core/combat";
import { handIndex, startState, testConfig } from "../helpers/combat";

/** P0-1 回归：敌人格挡必须在【敌人自己】的回合开始才清零。 */
describe("敌人格挡时序（P0-1）", () => {
  it("敌人防御后，格挡撑过玩家回合并被攻击消耗", () => {
    const started = startState(
      testConfig({ enemies: [{ id: "tank" }], deck: ["strike", "strike", "strike", "strike", "strike"], handSize: 5 }),
    );
    expect(started.enemies[0].intent?.kind).toBe("defend");

    const afterEnemy = reduce(started, { type: "EndTurn", actionId: "e" }).state;
    // 关键断言：进入玩家回合时，敌人的格挡仍然存在（修复前此处为 0）
    expect(afterEnemy.enemies[0].block).toBe(5);

    const index = handIndex(afterEnemy, "strike");
    const hit = reduce(afterEnemy, { type: "PlayCard", actionId: "p", handIndex: index, targetId: "tank" });
    // 6 点伤害先被 5 格挡吸收，只掉 1 HP
    expect(hit.state.enemies[0].hp).toBe(79);
    expect(hit.state.enemies[0].block).toBe(0);
    expect(hit.events.some((e) => e.type === "BlockBroken")).toBe(true);
  });

  it("敌人再次行动前清零旧格挡，不会累积", () => {
    let state = startState(
      testConfig({ enemies: [{ id: "tank" }], deck: ["defend", "defend", "defend", "defend", "defend"], handSize: 5 }),
    );
    state = reduce(state, { type: "EndTurn", actionId: "e1" }).state;
    expect(state.enemies[0].block).toBe(5);
    state = reduce(state, { type: "EndTurn", actionId: "e2" }).state;
    expect(state.enemies[0].block).toBe(5);
  });

  it("玩家格挡仍在自己回合开始清零（未被本次修复带偏）", () => {
    const started = startState(
      testConfig({ deck: ["defend", "defend", "defend", "defend", "defend"], handSize: 5 }),
    );
    const index = handIndex(started, "defend");
    const blocked = reduce(started, { type: "PlayCard", actionId: "p", handIndex: index }).state;
    expect(blocked.player.block).toBe(5);
    const nextTurn = reduce(blocked, { type: "EndTurn", actionId: "e" }).state;
    expect(nextTurn.player.block).toBe(0);
  });
});
