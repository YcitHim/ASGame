import { describe, expect, it } from "vitest";
import {
  PIPELINE_SPECS,
  VALUE_KINDS,
  evaluateValue,
  summarizeEvaluation,
  type Modifier,
  type ModifierLayer,
  type ModifierOp,
} from "@/core/pipeline";

const mod = (sourceId: string, layer: ModifierLayer, op: ModifierOp, value: number): Modifier => ({
  sourceId,
  layer,
  op,
  value,
});

describe("修饰符求值器（2.3 / docs/03 §1 六行表）", () => {
  it("卡牌费用：基础→升级→强化→Buff→临时，clamp ≥ 0", () => {
    const r = evaluateValue("cardCost", 2, [
      mod("upgrade", "upgrade", "add", -1),
      mod("thrift", "enhancement", "add", -1),
      mod("frenzy", "buff", "add", -1),
      mod("tmp", "temporary", "add", -1),
    ]);
    expect(r.value).toBe(0);
    expect(r.clamped).toBe(true);
  });

  it("攻击伤害：加区先于乘区，乘区后单次四舍五入", () => {
    // (6 + 3强化 + 2力量) ×1.5易伤 ×0.75虚弱 = 12.375 → 12
    const r = evaluateValue("attackDamage", 6, [
      mod("vulnerable", "buff", "mul", 1.5),
      mod("strength", "buff", "add", 2),
      mod("weak", "buff", "mul", 0.75),
      mod("bloodboil", "enhancement", "add", 3),
    ]);
    expect(r.raw).toBeCloseTo(12.375, 6);
    expect(r.value).toBe(12);
  });

  it("卖血代价：基础→强化→义体→遗物，clamp ≥ 0", () => {
    const r = evaluateValue("hpCost", 2, [
      mod("thrifty_pact", "enhancement", "add", -1),
      mod("blood_pump", "artifact", "add", -1),
      mod("broken_oil", "relic", "add", -1),
    ]);
    expect(r.value).toBe(0);
  });

  it("抽牌数：基础→Buff→临时", () => {
    const r = evaluateValue("drawCount", 1, [
      mod("focus", "buff", "add", 1),
      mod("tmp", "temporary", "add", -1),
    ]);
    expect(r.value).toBe(1);
  });

  it("格挡：基础→升级→强化→虚弱类乘法修正", () => {
    const r = evaluateValue("block", 5, [
      mod("upgrade", "upgrade", "add", 3),
      mod("shred", "buff", "mul", 0.75),
    ]);
    expect(r.raw).toBeCloseTo(6, 6);
    expect(r.value).toBe(6);
  });

  it("治疗量：基础→Buff 修正", () => {
    const r = evaluateValue("heal", 3, [mod("regen", "buff", "add", 2)]);
    expect(r.value).toBe(5);
  });

  it("加区先于乘区，与书写顺序无关", () => {
    const a = evaluateValue("attackDamage", 3, [
      mod("x", "buff", "mul", 2),
      mod("y", "buff", "add", 2),
    ]);
    const b = evaluateValue("attackDamage", 3, [
      mod("y", "buff", "add", 2),
      mod("x", "buff", "mul", 2),
    ]);
    expect(a.value).toBe(10);
    expect(b.value).toBe(10);
  });

  it("全流程只有一次取整（连续两乘再取整）", () => {
    const r = evaluateValue("attackDamage", 5, [
      mod("a", "buff", "mul", 1.5),
      mod("b", "buff", "mul", 0.75),
    ]);
    expect(r.raw).toBeCloseTo(5.625, 6);
    expect(r.value).toBe(6); // 若分两次取整会得到 5
  });

  it("跨层按冻结层序排序（enhancement 先于 buff）", () => {
    const r = evaluateValue("attackDamage", 10, [
      mod("buff_src", "buff", "add", 1),
      mod("enh_src", "enhancement", "add", 1),
    ]);
    expect(r.layers.map((l) => l.sourceId)).toEqual(["enh_src", "buff_src"]);
  });

  it("层明细可追溯 before/after", () => {
    const r = evaluateValue("attackDamage", 6, [mod("strength", "buff", "add", 2)]);
    expect(r.layers[0]).toEqual({
      sourceId: "strength",
      layer: "buff",
      op: "add",
      value: 2,
      before: 6,
      after: 8,
    });
  });

  it("非法修饰层立即报错，不静默吞掉", () => {
    expect(() => evaluateValue("drawCount", 1, [mod("relic", "relic", "add", 1)])).toThrow(/非法修饰层/);
  });

  it("无修饰时返回基础值", () => {
    const r = evaluateValue("heal", 3);
    expect(r.value).toBe(3);
    expect(r.layers).toEqual([]);
  });

  it("负基础值被 clamp 到 0", () => {
    const r = evaluateValue("cardCost", -2, []);
    expect(r.raw).toBe(-2);
    expect(r.value).toBe(0);
    expect(r.clamped).toBe(true);
  });

  it("六种数值都有管线规格", () => {
    for (const kind of VALUE_KINDS) {
      expect(PIPELINE_SPECS[kind].layers.length).toBeGreaterThan(0);
      expect(PIPELINE_SPECS[kind].rounding).toBe("round");
    }
  });

  it("摘要含修饰链，可读", () => {
    const text = summarizeEvaluation(evaluateValue("attackDamage", 6, [mod("strength", "buff", "add", 2)]));
    expect(text).toContain("+2(strength");
    expect(text).toContain("6→8");
    expect(text).toContain("→ 8");
  });
});
