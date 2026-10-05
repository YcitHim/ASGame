import { describe, expect, it } from "vitest";
import { EffectQueue, type QueuedEffect } from "@/core/pipeline";

const eff = (id: string, sourceId: string, targetIds: string[] = ["enemy-1"]): QueuedEffect<string> => ({
  id,
  sourceId,
  targetIds,
  payload: id,
});

describe("栈式效果队列（2.4 / ADR-002）", () => {
  it("LIFO 后进先出", () => {
    const q = new EffectQueue<string>();
    q.push(eff("A", "player"));
    q.push(eff("B", "player"));
    q.push(eff("C", "player"));
    expect([q.pop()?.id, q.pop()?.id, q.pop()?.id]).toEqual(["C", "B", "A"]);
    expect(q.pop()).toBeUndefined();
  });

  it("中途插入：结算中压栈优先结算", () => {
    const q = new EffectQueue<string>();
    q.push(eff("A", "player"));
    q.push(eff("B", "player"));
    const first = q.pop();
    expect(first?.id).toBe("B");
    q.push(eff("C", "player")); // 连锁触发插入
    expect(q.pop()?.id).toBe("C");
    expect(q.pop()?.id).toBe("A");
  });

  it("死亡清理：移除来源或目标为该单位的挂起动作", () => {
    const q = new EffectQueue<string>();
    q.push(eff("A", "player", ["enemy-1"]));
    q.push(eff("B", "enemy-1", ["player"]));
    q.push(eff("C", "enemy-2", ["player"]));
    const removed = q.removeByUnit("enemy-1");
    expect(removed.map((e) => e.id).sort()).toEqual(["A", "B"]);
    expect(q.size).toBe(1);
    expect(q.peek()?.id).toBe("C");
  });

  it("深度超限报错（触发循环保护）", () => {
    const q = new EffectQueue<string>({ maxDepth: 2 });
    q.push(eff("A", "player"));
    q.push(eff("B", "player"));
    expect(() => q.push(eff("C", "player"))).toThrow(/深度超限/);
  });

  it("drain 按 LIFO 清空并计数 processed", () => {
    const q = new EffectQueue<string>();
    q.push(eff("A", "player"));
    q.push(eff("B", "player"));
    expect(q.drain().map((e) => e.id)).toEqual(["B", "A"]);
    expect(q.size).toBe(0);
    expect(q.processed).toBe(2);
    expect(q.processed).toBeGreaterThan(0);
  });

  it("clear / dump / peek 空队列行为", () => {
    const q = new EffectQueue<string>();
    expect(q.peek()).toBeUndefined();
    q.push(eff("A", "player"));
    expect(q.dump()).toEqual([{ id: "A", sourceId: "player", targetIds: ["enemy-1"] }]);
    q.clear();
    expect(q.size).toBe(0);
  });
});
