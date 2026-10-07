// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewEnergyCost } from "@/core/combat";
import { MESSAGE_TTL_MS, useBattleStore } from "@/stores/battle";

/**
 * docs/41 §2.1（反馈 4/6）：打牌失败的提示不能跨回合残留。
 *
 * 复现路径：空能量点牌 → 提示出现 → 结束回合 → 新回合提示必须已消失。
 * 提示是 UI 纯表现（不进 core 事件流），所以回归固化在 store 层而不是 golden replay；
 * golden 只覆盖 core 输入流 → 事件流，无法表达 toast 生命周期（已在 docs/41 执行记录登记）。
 */
describe("docs/41 §2.1 提示生命周期", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("能量不足的提示在新回合开始时消失", () => {
    const store = useBattleStore();
    store.start();
    store.skip();
    const battle = store.battle!;
    // 把能量压到 0，制造「能量不足」路径
    store.debug(`set energy 0`);
    store.skip();
    const idx = battle.piles.hand.findIndex((_id, i) => previewEnergyCost(battle, i) > 0);
    expect(idx, "手牌里应有需要能量的牌").toBeGreaterThanOrEqual(0);
    store.selectCard(idx);
    expect(store.message).toContain("能量不足");
    expect(store.messageKind).toBe("error");

    store.endTurn();
    store.skip();
    // TurnStarted 已到达：上一回合的提示必须清空
    expect(store.message).toBe("");
  });

  it("报错提示 2.5 秒后自动消散（不影响 info 类引导）", () => {
    const store = useBattleStore();
    store.start();
    store.skip();
    store.setMessage("能量不足（需要 1，剩余 0）");
    expect(store.message).not.toBe("");
    vi.advanceTimersByTime(MESSAGE_TTL_MS + 1);
    expect(store.message).toBe("");

    // 「选择目标」是操作引导，不自动消散
    store.setMessage("选择目标", "info");
    vi.advanceTimersByTime(MESSAGE_TTL_MS * 2);
    expect(store.message).toBe("选择目标");
  });
});
