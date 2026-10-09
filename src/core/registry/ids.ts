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
  /** 本回合打出的**攻击牌**数 ≥ n（docs/64 饥锈胃袋） */
  "attacksPlayedThisTurn",
  /** 回合结束那一刻手牌为空（docs/64 空腹铃铛 / 唱诗班终曲）：读结束回合时捕获的快照 */
  "handEmptyAtTurnEnd",
  /** 上一回合一张牌都没打（docs/64 停摆八音盒）：第 1 回合恒为假 */
  "playedNoCardsLastTurn",
  /** 当前 HP ≤ n 点（绝对值，docs/64 血泵心脏二段「压血线」） */
  "hpAtMost",
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
  "weak",
  "block",
  "regeneration",
  "pollution",
  /** 蚀锈（docs/38 §二 B-2）：敌人侧 DoT，stacks = 每回合伤害，duration = 剩余回合 */
  "corroding",
  /** 回血印记（调血）：玩家回合开始时按 stacks 回血一次，随后消失 */
  "mending",
  /** 胆怯（docs/46 §2.2）：每层承伤 +10%，上限 5 层，战斗结束清零 */
  "timid",
  /** 荆棘（docs/46 §2.3）：每层受击反弹 3 点固定伤害，上限 5 层 */
  "bramble",
  /** 坚韧（docs/46 §3.4）：每层回合开始 +3 维续格挡，上限 3 层 */
  "tenacity",
  /** 冰缓（docs/46 §3.7 诅咒·规则）：层数 = 剩余回合；玩家手牌费用 +1 / 敌人造伤 −20%，上限 3 层 */
  "chill",
  /** 颠倒（docs/46 §3.8 诅咒·规则）：层数 = 剩余回合；玩家手牌费用每回合随机 0~3 / 敌人意图数值 50%~150%，上限 2 层 */
  "reverse",
  /** 眩晕（docs/46 §3.5 诅咒·控制）：下一整回合不可行动；不可叠加，精英/Boss 首免后再免 */
  "stun",
  /** 灼烧（docs/46 §3.9 异常 / 甲方 2026-10-08 补丁）：回合开始每层 −1 生命上限（战斗内，上限 5 层）；带有灼烧时生命恢复 −50% */
  "burn",
  /**
   * 超负荷（docs/58 §六 玻璃大炮）：层级型**减益**——战斗结束清零、不衰减。
   * 每层：获得时立即受 2 点伤害 + 每张卡获得的格挡 −1。
   * ⚠️ docs/46 原裁定「层级型为九相专用」，本项为甲方拍板的开口子（docs/58 §六-2 回写事项）。
   */
  "overload",
  /**
   * 特殊防御状态（docs/60 §八.3，甲方 2026-10-08）：**敌人自身**的减伤形态，
   * 不进「异常 / 诅咒 / 加持」三分类。层数 = 剩余回合（在玩家回合结束时 −1）。
   * - 虚化 ethereal：只吃**技能牌**伤害（攻击牌打上去归零）；
   * - 魔免 magicimmune：只吃**攻击牌**伤害（技能牌打上去归零）；
   * - 不屈 unbreakable：本回合累计受伤害上限 = ceil(自身 maxHp × 15%)，超出部分直接不算。
   */
  "ethereal",
  "magicimmune",
  "unbreakable",
  /**
   * 临界硬化（docs/60 §四 锈喉转阶段保护，甲方 2026-10-08 口述修订）：
   * 血线被**跨过** 50% 后挂上的 99% 减伤——跨过那一击照常吃满，
   * 本回合后续所有伤害减到 1/100，**玩家回合结束时消失**（decayAt turnEnd，1 回合）。
   */
  "phase_ward",
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
  /** docs/66 批 3 第三幕专属强化（锈心锻炉） */
  "forgeheart",
  "slagplate",
  "emberdraw",
] as const;

export const CARD_TYPES = ["attack", "skill", "power", "curse", "status"] as const;
export const CARD_RARITIES = ["starter", "common", "uncommon", "rare", "special"] as const;
/**
 * 职业特性 id（docs/58 §二）：开局除「无特性」外的一档，全程绑定本局。
 *
 * 实现纪律（docs/58 §二-3 / 铁律 6）：特性走 **classTrait 注册表**（id / handler / params），
 * 禁止任何 classId 字符串特判——挂载方式等同「开局自带的隐藏遗物」，复用触发器与修饰符管线。
 */
export const TRAIT_IDS = ["bloodthirst", "ironhide_turtle", "glass_cannon", "super_mutation"] as const;
/** 特性逻辑 handler（ADR-005）：JSON 只传参，机制逻辑在 trait-handler.ts（纯 TS、可单测）。 */
export const TRAIT_HANDLER_IDS = ["bloodthirst", "ironhide_turtle", "glass_cannon", "super_mutation"] as const;
/**
 * 遗物规则 handler（docs/64 §三，与 trait-handler 同构）：
 * JSON 只声明 handler / params，机制逻辑在 relic-handler.ts；引擎问「能力」不查 relicId。
 */
export const RELIC_HANDLER_IDS = [
  "heal_grants_block",
  "kill_heal",
  "exhaust_draw",
  "on_hit_apply_buff",
  "energy_spent_refund",
  "hp_to_block",
  "first_card_double",
  "first_attack_bonus",
  "keep_block",
  "cheat_death",
  "pollution_overflow_relief",
  "battle_win_growth",
  "relic_gain_heal",
  /** docs/64 §九.4 备选池：淬火怀表（每场首次掉 HP 给力量） */
  "first_hit_strength",
] as const;
/**
 * 卡牌归属池（docs/56 §二）：三职业 + 中立。
 * 归属只看「身份指纹」（机制），不看风味——打击/防御这种谁都能用的卡不该占着血械的池子。
 */
export const CARD_CLASSES = ["bloodwright", "engineer", "rustspeaker", "neutral"] as const;
export const ENHANCEMENT_TIERS = [1, 2, 3] as const;

export type KeywordId = (typeof KEYWORD_IDS)[number];
export type ConditionId = (typeof CONDITION_IDS)[number];
export type TargetId = (typeof TARGET_IDS)[number];
export type BuffId = (typeof BUFF_IDS)[number];
export type CardHandlerId = (typeof CARD_HANDLER_IDS)[number];
export type EnhancementHandlerId = (typeof ENHANCEMENT_HANDLER_IDS)[number];
export type CardType = (typeof CARD_TYPES)[number];
export type CardRarity = (typeof CARD_RARITIES)[number];
export type TraitId = (typeof TRAIT_IDS)[number];
export type TraitHandlerId = (typeof TRAIT_HANDLER_IDS)[number];
export type RelicHandlerId = (typeof RELIC_HANDLER_IDS)[number];

export type RegistryKind =
  | "keyword"
  | "condition"
  | "target"
  | "buff"
  | "cardHandler"
  | "enhancementHandler"
  | "trait"
  | "traitHandler"
  | "relicHandler";

const REGISTRY: Record<RegistryKind, readonly string[]> = {
  keyword: KEYWORD_IDS,
  condition: CONDITION_IDS,
  target: TARGET_IDS,
  buff: BUFF_IDS,
  cardHandler: CARD_HANDLER_IDS,
  enhancementHandler: ENHANCEMENT_HANDLER_IDS,
  trait: TRAIT_IDS,
  traitHandler: TRAIT_HANDLER_IDS,
  relicHandler: RELIC_HANDLER_IDS,
};

export function isRegistered(kind: RegistryKind, id: string): boolean {
  return REGISTRY[kind].includes(id);
}

export function registeredIds(kind: RegistryKind): readonly string[] {
  return REGISTRY[kind];
}
