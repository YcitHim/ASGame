/**
 * core/keywords · 关键词系统（ADR-004，注册制）
 *
 * 关键词 = 统一钩子接口的机制单元。新职业加机制 = 注册新关键词，不改核心。
 * v0 生效钩子：消耗 / 保留 / 虚无 / 固有 / 血契；充能·污染·过载·再生 的结构已预留。
 */
import type { KeywordId } from "../registry/ids";

export type HandDestination = "discard" | "retain" | "exhaust";

export interface KeywordHooks {
  readonly id: KeywordId;
  /** 打出结算完成后卡牌去向（默认 discard） */
  readonly afterPlay?: "discard" | "exhaust";
  /** 回合结束时仍留在手牌的处置（默认 discard） */
  readonly inHandAtTurnEnd?: HandDestination;
  /** 战斗开始保证在起手牌 */
  readonly innate?: boolean;
  /** 打出前需支付自身 HP 代价（读 card.bloodCost） */
  readonly pactCost?: boolean;
  /** 结算数值钩子说明（保留给 0.5，v0 仅记录语义） */
  readonly note?: string;
}

export const KEYWORD_HOOKS: Readonly<Record<KeywordId, KeywordHooks>> = {
  exhaust: { id: "exhaust", afterPlay: "exhaust" },
  retain: { id: "retain", inHandAtTurnEnd: "retain" },
  ethereal: { id: "ethereal", inHandAtTurnEnd: "exhaust" },
  innate: { id: "innate", innate: true },
  bloodpact: { id: "bloodpact", pactCost: true },
  charge: { id: "charge", note: "累积充能点（gainCharge 效果驱动）" },
  pollution: { id: "pollution", note: "改变污染值（gainPollution 效果驱动）" },
  overload: { id: "overload", note: "充能超限反噬（combat 结算）" },
  regenerate: { id: "regenerate", note: "回合开始回血（regeneration Buff 驱动）" },
  corroding: { id: "corroding", note: "敌人侧蚀锈 DoT（applyBuff corroding 驱动，docs/38 §二 B-2）" },
};

export interface CardKeywordView {
  readonly keywords?: readonly KeywordId[];
  readonly bloodCost?: number;
}

function hooksOf(card: CardKeywordView, key: keyof KeywordHooks): KeywordHooks[] {
  return (card.keywords ?? []).map((k) => KEYWORD_HOOKS[k]).filter((h) => h[key] !== undefined);
}

/** 打出后去向：消耗关键词优先。 */
export function afterPlayDestination(card: CardKeywordView): "discard" | "exhaust" {
  return hooksOf(card, "afterPlay").some((h) => h.afterPlay === "exhaust") ? "exhaust" : "discard";
}

/** 回合结束在手牌的处置：虚无（先）→ 保留 → 默认弃置。 */
export function turnEndDestination(card: CardKeywordView): HandDestination {
  if (hooksOf(card, "inHandAtTurnEnd").some((h) => h.inHandAtTurnEnd === "exhaust")) return "exhaust";
  if (hooksOf(card, "inHandAtTurnEnd").some((h) => h.inHandAtTurnEnd === "retain")) return "retain";
  return "discard";
}

export function isInnate(card: CardKeywordView): boolean {
  return hooksOf(card, "innate").some((h) => h.innate === true);
}

/** 血契需要支付的 HP（无血契关键词则为 0）。 */
export function pactHpCost(card: CardKeywordView): number {
  if (!hooksOf(card, "pactCost").some((h) => h.pactCost === true)) return 0;
  return Math.max(0, card.bloodCost ?? 0);
}

export function hasKeyword(card: CardKeywordView, id: KeywordId): boolean {
  return (card.keywords ?? []).includes(id);
}
