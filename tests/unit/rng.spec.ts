import { describe, expect, it } from "vitest";
import { Rng, RngStream, STREAM_NAMES, deriveStreamSeed } from "@/core/rng";

describe("core/rng 分流（ADR-006 / 2.1）", () => {
  it("同种子同流序列一致", () => {
    const a = new Rng(12345).stream("combat");
    const b = new Rng(12345).stream("combat");
    const seqA = Array.from({ length: 25 }, () => a.nextFloat());
    const seqB = Array.from({ length: 25 }, () => b.nextFloat());
    expect(seqA).toEqual(seqB);
  });

  it("不同种子序列不同", () => {
    const a = new Rng(1).stream("combat");
    const b = new Rng(2).stream("combat");
    expect(Array.from({ length: 10 }, () => a.nextFloat())).not.toEqual(
      Array.from({ length: 10 }, () => b.nextFloat()),
    );
  });

  it("消费 map 流不影响 combat 流序列", () => {
    const untampered = new Rng(999);
    const expected = Array.from({ length: 10 }, () => untampered.stream("combat").nextFloat());

    const tampered = new Rng(999);
    for (let i = 0; i < 50; i += 1) tampered.stream("map").nextFloat();
    tampered.stream("reward").nextFloat();
    const actual = Array.from({ length: 10 }, () => tampered.stream("combat").nextFloat());

    expect(actual).toEqual(expected);
  });

  it("各流派生种子互不相同", () => {
    const seeds = STREAM_NAMES.map((n) => deriveStreamSeed(42, n));
    expect(new Set(seeds).size).toBe(STREAM_NAMES.length);
  });

  it("nextInt 为闭区间整数", () => {
    const s = new Rng(7).stream("ai");
    for (let i = 0; i < 200; i += 1) {
      const v = s.nextInt(3, 5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
    }
    expect(s.nextInt(9, 9)).toBe(9);
  });

  it("shuffle 是合法排列且确定性", () => {
    const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const first = new Rng(2026).stream("combat").shuffle(arr);
    const second = new Rng(2026).stream("combat").shuffle(arr);
    expect(first).toEqual(second);
    expect(first).not.toBe(arr);
    expect(arr).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect([...first].sort((a, b) => a - b)).toEqual(arr);
  });

  it("weighted 不选中权重为 0 的项", () => {
    const s = new Rng(5).stream("reward");
    for (let i = 0; i < 100; i += 1) {
      expect(s.weighted([["a", 1] as const, ["b", 0] as const])).toBe("a");
    }
  });

  it("pick 从数组取元素", () => {
    const s = new Rng(8).stream("fx");
    const pool = ["x", "y", "z"];
    for (let i = 0; i < 20; i += 1) expect(pool).toContain(s.pick(pool));
  });

  it("快照与恢复后续跑序列一致", () => {
    const s = new Rng(31415).stream("combat");
    for (let i = 0; i < 5; i += 1) s.nextFloat();
    const snap = s.snapshot();
    const expected = Array.from({ length: 10 }, () => s.nextFloat());
    const resumed = RngStream.fromSnapshot(snap);
    expect(Array.from({ length: 10 }, () => resumed.nextFloat())).toEqual(expected);
  });

  it("Rng 整包快照可续跑", () => {
    const rng = new Rng(2718);
    rng.stream("combat").nextFloat();
    const snapshot = rng.snapshot();
    const expected = Array.from({ length: 8 }, () => rng.stream("map").nextInt(0, 100));

    const restored = Rng.fromSnapshot(2718, snapshot);
    expect(Array.from({ length: 8 }, () => restored.stream("map").nextInt(0, 100))).toEqual(expected);
  });

  it("非法输入立即报错", () => {
    const s = new Rng(1).stream("combat");
    expect(() => s.nextInt(5, 1)).toThrow();
    expect(() => s.nextInt(0.5, 2)).toThrow();
    expect(() => s.pick([])).toThrow();
    expect(() => s.weighted([])).toThrow();
    expect(() => s.weighted([["a", 0]] as const)).toThrow();
    expect(() => s.weighted([["a", -1]] as const)).toThrow();
  });
});
