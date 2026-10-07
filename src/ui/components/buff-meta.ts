/**
 * ui/components/buff-meta · 状态图标元数据
 *
 * 字形 / 配色 / 数值单位集中在这里；说明文案复用 glossary，
 * 避免「同一条机制两处维护、改一处漏一处」。
 */
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
  corroding: { name: "蚀锈", glyph: "蚀", tint: "#556b2a", unit: "伤害" },
  mending: { name: "回血印记", glyph: "愈", tint: "#3f6b3a", unit: "点" },
};

export function buffMeta(id: string): BuffMeta {
  return BUFF_META[id] ?? { name: id, glyph: id.slice(0, 1).toUpperCase(), tint: "#6b5a3a", unit: "" };
}

/** 状态说明：取 glossary 的同名词条，保证与卡面注解口径一致。 */
export function buffTip(id: string): string {
  return GLOSSARY[buffMeta(id).name] ?? "";
}

/** 角标数值：计时型显示剩余回合，其余显示层数。 */
export function buffAmount(buff: { id: string; stacks: number; duration?: number | null }): number {
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
