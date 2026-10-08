/**
 * ui/components/buff-meta · 状态图标元数据
 *
 * 字形 / 配色 / 数值单位集中在这里；说明文案复用 glossary，
 * 避免「同一条机制两处维护、改一处漏一处」。
 */
import { BUFF_DEFINITIONS } from "@/core/buffs";
import type { BuffId } from "@/core/registry/ids";
import { GLOSSARY } from "@/ui/glossary";

export interface BuffMeta {
  readonly name: string;
  readonly glyph: string;
  /** 图标底色（CSS 颜色） */
  readonly tint: string;
  /** 数值单位：层 / 回合 / 点 */
  readonly unit: string;
}

export const BUFF_META: Record<string, BuffMeta> = {
  strength: { name: "力量", glyph: "力", tint: "#8c2f22", unit: "层" },
  timid: { name: "胆怯", glyph: "怯", tint: "#8a5a1f", unit: "层" },
  weak: { name: "虚弱", glyph: "弱", tint: "#4a5866", unit: "层" },
  regeneration: { name: "再生", glyph: "生", tint: "#3f6b3a", unit: "层" },
  pollution: { name: "污染", glyph: "污", tint: "#5b3a7a", unit: "点" },
  bramble: { name: "荆棘", glyph: "荆", tint: "#6b1f34", unit: "层" },
  tenacity: { name: "坚韧", glyph: "韧", tint: "#b08d4a", unit: "层" },
  block: { name: "格挡", glyph: "盾", tint: "#54636f", unit: "点" },
  // 蚀锈改成纯层数后单位跟着卡面口径走（卡面写「施加 2 点蚀锈」）
  corroding: { name: "蚀锈", glyph: "蚀", tint: "#556b2a", unit: "点" },
  mending: { name: "回血印记", glyph: "愈", tint: "#3f6b3a", unit: "点" },
  // 九相后半（docs/49 Phase 2a）：异常红 / 诅咒紫
  burn: { name: "灼烧", glyph: "灼", tint: "#8c2f22", unit: "层" },
  chill: { name: "冰缓", glyph: "缓", tint: "#3f5a7a", unit: "回合" },
  reverse: { name: "颠倒", glyph: "颠", tint: "#5b3a7a", unit: "回合" },
  stun: { name: "眩晕", glyph: "晕", tint: "#3f2f6b", unit: "回合" },
  // 玻璃大炮专属（docs/58 §六.2）：层级型减益，战斗结束清零
  overload: { name: "超负荷", glyph: "荷", tint: "#8c5a1f", unit: "层" },
  // 特殊防御状态（docs/60 §八.3，甲方 2026-10-08）：敌人自身的减伤形态，层数 = 剩余回合
  ethereal: { name: "虚化", glyph: "虚", tint: "#3f5a7a", unit: "回合" },
  magicimmune: { name: "魔免", glyph: "魔", tint: "#5b3a7a", unit: "回合" },
  unbreakable: { name: "不屈", glyph: "屈", tint: "#54636f", unit: "回合" },
  // 临界硬化（docs/60 §四 锈喉转阶段保护，甲方 2026-10-08 口述修订）：99% 减伤，本回合结束消失
  phase_ward: { name: "临界硬化", glyph: "硬", tint: "#7a5a2f", unit: "回合" },
};

export function buffMeta(id: string): BuffMeta {
  return BUFF_META[id] ?? { name: id, glyph: id.slice(0, 1).toUpperCase(), tint: "#6b5a3a", unit: "" };
}

/** 状态说明：取 glossary 的同名词条，保证与卡面注解口径一致。 */
export function buffTip(id: string): string {
  return GLOSSARY[buffMeta(id).name] ?? "";
}

/**
 * 角标数值（甲方 2026-10-08 修）：
 * - **强度型**（层数）→ 层数；
 * - **stacksAndTurns 型**（再生 / 回血印记：同时有强度与剩余回合）→ **显示强度**。
 *   此前一律「有 duration 就显示 duration」，于是 6 层再生角标显示成 2（剩余回合），
 *   跟悬停提示里的「6 层 · 剩余 2 回合」自相矛盾——层数才是玩家要盯的数。
 * - **纯计时型**（没有独立强度，只有剩余回合）→ 剩余回合。
 */
export function buffAmount(buff: { id: string; stacks: number; duration?: number | null }): number {
  const def = BUFF_DEFINITIONS[buff.id as BuffId];
  if (def?.applyAs === "stacksAndTurns") return buff.stacks;
  return buff.duration != null ? buff.duration : buff.stacks;
}

export function buffValueText(buff: { id: string; stacks: number; duration?: number | null }): string {
  const meta = buffMeta(buff.id);
  if (buff.duration != null) {
    // stacksAndTurns 型（反伤）要同时说清强度与剩余回合；计时型（易伤/虚弱）stacks 恒为 1，不显示
    return buff.stacks > 1
      ? `${buff.stacks} ${meta.unit} · 剩余 ${buff.duration} 回合`
      : `剩余 ${buff.duration} 回合`;
  }
  return `${buff.stacks} ${meta.unit}`.trim();
}
