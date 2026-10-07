/**
 * core/registry · v0 注册表 id 集（ADR-004 / docs/04 §1）
 *
 * 本文件是「构建期校验」的单一事实来源：content-validator 用它判断 JSON 里
 * 出现的 id 是否已注册。S2 会在此基础上补上真正的行为实现（register + lookup），
 * 但 id 名字面量只增不改。
 */

/** 关键词（docs/04 §1：消耗/保留/虚无/固有/血契/充能/污染/过载/再生） */
export const KEYWORD_IDS = [
  "exhaust",
  "retain",
  "ethereal",
  "innate",
  "bloodpact",
  "charge",
  "pollution",
  "overload",
  "regenerate",
  /** 蚀锈（docs/38 §二 B-2）：敌人侧 DoT 标记 */
  "corroding",
] as const;

/** 条件（可组合：and / or / not） */
export const CONDITION_IDS = [
  "hpBelow",
  "hpAtLeast",
  "selfHpBelow",
  "selfHpAtLeast",
  "pollutionAbove",
  "pollutionBelow",
  "pollutionAtLeast",
  "chargeAtLeast",
  "hasBuff",
  "cardsPlayedThisTurn",
  "handIsEmpty",
  /** 本回合（含刚结束的敌方回合）玩家受到过攻击伤害（docs/16 P2.3） */
  "tookDamageThisTurn",
  /** 目标敌人身上的 Buff（docs/38 §二 B-3「疫触」）：逐目标判定，不在入栈时快照 */
  "targetHasBuff",
] as const;

/** 目标选择器 */
export const TARGET_IDS = [
  "self",
  "chosenEnemy",
  "randomEnemy",
  "allEnemies",
  "lowestHpEnemy",
  "highestHpEnemy",
] as const;

/** Buff（S3.3 六个基础 Buff + 后续扩展） */
export const BUFF_IDS = [
  "strength",
  "vulnerable",
  "weak",
  "block",
  "regeneration",
  "pollution",
  /** 反伤（荆棘血痂，docs/16 P2.1）：受攻击时对攻击者造成 stacks 点伤害 */
  "thorns",
  /** 蚀锈（docs/38 §二 B-2）：敌人侧 DoT，stacks = 每回合伤害，duration = 剩余回合 */
  "corroding",
  /** 回血印记（调血）：玩家回合开始时按 stacks 回血一次，随后消失 */
  "mending",
] as const;

/** 卡牌复杂逻辑 handler（ADR-005） */
export const CARD_HANDLER_IDS = ["multihit", "rampageOnSameTarget"] as const;

/** 强化机制 handler（ADR-005，S4 只验 bloodboil） */
export const ENHANCEMENT_HANDLER_IDS = [
  "bloodboil",
  "empower",
  "fortify",
  "bloodpact_discount",
  "bloodrage",
  /** docs/23 §1 三枚新强化 */
  "lighten",
  "rustbite",
  "bloodwage",
  /** docs/40 §七 幕专属强化 */
  "abyssal_hush",
  "sunk_cost",
  "choir_reverb",
] as const;

export const CARD_TYPES = ["attack", "skill", "power", "curse", "status"] as const;
export const CARD_RARITIES = ["starter", "common", "uncommon", "rare", "special"] as const;
export const CARD_CLASSES = ["bloodwright", "engineer", "rustspeaker"] as const;
export const ENHANCEMENT_TIERS = [1, 2, 3] as const;

export type KeywordId = (typeof KEYWORD_IDS)[number];
export type ConditionId = (typeof CONDITION_IDS)[number];
export type TargetId = (typeof TARGET_IDS)[number];
export type BuffId = (typeof BUFF_IDS)[number];
export type CardHandlerId = (typeof CARD_HANDLER_IDS)[number];
export type EnhancementHandlerId = (typeof ENHANCEMENT_HANDLER_IDS)[number];
export type CardType = (typeof CARD_TYPES)[number];
export type CardRarity = (typeof CARD_RARITIES)[number];

export type RegistryKind = "keyword" | "condition" | "target" | "buff" | "cardHandler" | "enhancementHandler";

const REGISTRY: Record<RegistryKind, readonly string[]> = {
  keyword: KEYWORD_IDS,
  condition: CONDITION_IDS,
  target: TARGET_IDS,
  buff: BUFF_IDS,
  cardHandler: CARD_HANDLER_IDS,
  enhancementHandler: ENHANCEMENT_HANDLER_IDS,
};

export function isRegistered(kind: RegistryKind, id: string): boolean {
  return REGISTRY[kind].includes(id);
}

export function registeredIds(kind: RegistryKind): readonly string[] {
  return REGISTRY[kind];
}
