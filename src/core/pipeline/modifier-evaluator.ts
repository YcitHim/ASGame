/**
 * core/pipeline · 修饰符求值器（ADR-003 / docs/03 §1，冻结规范）
 *
 * 一切对外数值：基础值 → 升级 → 强化 → … → 本场临时，逐层有序求值，
 * 每层产出可追溯明细（写进事件载荷）。
 *
 * 冻结规则：
 *  - 加区先于乘区（与修饰列表书写顺序无关）
 *  - 全流程只有【一个】四舍五入点，位于乘区之后
 *  - 结果 clamp ≥ 0
 *  - 禁止层间覆盖：只支持 add / mul，不支持 set
 */

export type ModifierLayer =
  | "base"
  | "upgrade"
  | "enhancement"
  | "artifact"
  | "relic"
  | "buff"
  | "temporary";

export const MODIFIER_LAYER_ORDER: readonly ModifierLayer[] = [
  "base",
  "upgrade",
  "enhancement",
  "artifact",
  "relic",
  "buff",
  "temporary",
];

export type ModifierOp = "add" | "mul";

export interface Modifier {
  readonly sourceId: string;
  readonly layer: ModifierLayer;
  readonly op: ModifierOp;
  readonly value: number;
  /**
   * 该修饰作用于哪个数值种类。仅"本场临时修饰"（BattleState.modifiers）需要，
   * 其余层由消费点决定（enhancement 只会喂给对应的 evaluateValue）。
   */
  readonly kind?: ValueKind;
}

export const VALUE_KINDS = [
  "cardCost",
  "attackDamage",
  "hpCost",
  "drawCount",
  "block",
  "heal",
  /** 反噬伤害乘区（docs/38 §二 B-2「铁胃」）：作用于过载/污染反噬的固定伤害 */
  "backlashTaken",
] as const;
export type ValueKind = (typeof VALUE_KINDS)[number];

interface PipelineSpec {
  /** 允许出现在该数值上的层（顺序即求值层序） */
  readonly layers: readonly ModifierLayer[];
  /** 取整方式：目前一律在乘区后 round 一次 */
  readonly rounding: "round";
}

/** docs/03 §1 六行表的结构化表达。 */
export const PIPELINE_SPECS: Record<ValueKind, PipelineSpec> = {
  cardCost: { layers: ["base", "upgrade", "enhancement", "buff", "temporary"], rounding: "round" },
  attackDamage: { layers: ["base", "upgrade", "enhancement", "buff", "temporary"], rounding: "round" },
  hpCost: { layers: ["base", "enhancement", "artifact", "relic"], rounding: "round" },
  drawCount: { layers: ["base", "buff", "temporary"], rounding: "round" },
  block: { layers: ["base", "upgrade", "enhancement", "buff"], rounding: "round" },
  heal: { layers: ["base", "buff"], rounding: "round" },
  backlashTaken: { layers: ["base", "enhancement", "artifact", "relic", "buff", "temporary"], rounding: "round" },
};

export interface ModifierDetail {
  readonly sourceId: string;
  readonly layer: ModifierLayer;
  readonly op: ModifierOp;
  readonly value: number;
  readonly before: number;
  readonly after: number;
}

export interface EvaluatedValue {
  readonly kind: ValueKind;
  readonly base: number;
  /** 取整前的原始值 */
  readonly raw: number;
  /** 最终值：单次取整 + clamp ≥ 0 */
  readonly value: number;
  /** 是否发生过 clamp */
  readonly clamped: boolean;
  readonly layers: readonly ModifierDetail[];
}

const layerIndex = (layer: ModifierLayer): number => MODIFIER_LAYER_ORDER.indexOf(layer);

/**
 * 求值入口。
 * @throws 当修饰层不在该数值允许的层内（内容配错立刻炸，不静默吞掉）
 */
export function evaluateValue(
  kind: ValueKind,
  base: number,
  modifiers: readonly Modifier[] = [],
): EvaluatedValue {
  const spec = PIPELINE_SPECS[kind];
  for (const m of modifiers) {
    if (!spec.layers.includes(m.layer)) {
      throw new Error(`evaluateValue(${kind}): 非法修饰层 "${m.layer}"（来自 ${m.sourceId}）`);
    }
  }

  // 同层内保持书写序（Array.prototype.sort 稳定），跨层按冻结层序。
  const ordered = modifiers
    .map((m, i) => ({ m, i }))
    .sort((a, b) => layerIndex(a.m.layer) - layerIndex(b.m.layer) || a.i - b.i)
    .map((x) => x.m);

  const layers: ModifierDetail[] = [];
  let current = base;

  // 加区先于乘区：分两遍，不按书写顺序交错。
  for (const m of ordered) {
    if (m.op !== "add") continue;
    const before = current;
    current += m.value;
    layers.push({ sourceId: m.sourceId, layer: m.layer, op: m.op, value: m.value, before, after: current });
  }
  for (const m of ordered) {
    if (m.op !== "mul") continue;
    const before = current;
    current *= m.value;
    layers.push({ sourceId: m.sourceId, layer: m.layer, op: m.op, value: m.value, before, after: current });
  }

  const raw = current;
  const rounded = Math.round(raw);
  const value = rounded < 0 ? 0 : rounded;
  return { kind, base, raw, value, clamped: rounded !== value, layers };
}

/** 给日志面板/调试控制台用的一行摘要。 */
export function summarizeEvaluation(result: EvaluatedValue): string {
  const chain = result.layers
    .map((l) => `${l.op === "mul" ? "×" : "+"}${l.value}(${l.sourceId}: ${l.before}→${l.after})`)
    .join(" ");
  return `${result.kind} ${result.base}${chain ? " " + chain : ""} = ${result.raw} → ${result.value}`;
}
