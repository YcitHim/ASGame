import { describe, expect, it } from "vitest";
import { buffAmount, buffValueText } from "@/ui/components/buff-meta";

/**
 * 甲方 2026-10-08：再生 6 层却显示成 2（角标错取了 duration/剩余回合）。
 * 口径：stacksAndTurns 型（再生 / 回血印记）的角标显示**强度**，剩余回合放悬停提示。
 */
describe("状态角标取值", () => {
  it("再生：6 层 · 剩余 2 回合 → 角标显示 6（不是 2）", () => {
    const buff = { id: "regeneration", stacks: 6, duration: 2 };
    expect(buffAmount(buff)).toBe(6);
    expect(buffValueText(buff)).toBe("6 层 · 剩余 2 回合");
  });

  it("回血印记（同样是 stacksAndTurns）也显示强度", () => {
    expect(buffAmount({ id: "mending", stacks: 7, duration: 1 })).toBe(7);
  });

  it("纯层数型照旧显示层数", () => {
    expect(buffAmount({ id: "weak", stacks: 3, duration: null })).toBe(3);
    expect(buffAmount({ id: "bramble", stacks: 10, duration: null })).toBe(10);
  });

  it("未登记的 id 走缺省：有 duration 就显示 duration（向后兼容）", () => {
    expect(buffAmount({ id: "unknown_buff", stacks: 6, duration: 2 })).toBe(2);
  });
});
