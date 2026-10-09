import { z } from "zod";
import { ACT_RULE_IDS, NODE_KINDS } from "../../../src/core/registry/content";
import { VALUE_KINDS } from "../../../src/core/pipeline";
import {
  BUFF_IDS,
  CARD_CLASSES,
  CARD_HANDLER_IDS,
  CARD_RARITIES,
  CARD_TYPES,
  CONDITION_IDS,
  ENHANCEMENT_HANDLER_IDS,
  ENHANCEMENT_TIERS,
  KEYWORD_IDS,
  RELIC_HANDLER_IDS,
  TARGET_IDS,
  TRAIT_HANDLER_IDS,
} from "../../../src/core/registry/ids";

/** 内容 id 命名规范：snake_case（docs/04 §4）。 */
export const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

const idSchema = z.string().regex(ID_PATTERN, "id 必须为 snake_case（小写字母开头）");
const targetSchema = z.object({ type: z.enum(TARGET_IDS) }).strict();

/** 条件可递归组合：and / or / not + 已注册原子条件。 */
export type ConditionNode = { type: string } & Record<string, unknown>;

const conditionSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("and"), of: z.array(conditionSchema).min(1) }).strict(),
    z.object({ type: z.literal("or"), of: z.array(conditionSchema).min(1) }).strict(),
    z.object({ type: z.literal("not"), of: conditionSchema }).strict(),
    z.object({ type: z.enum(CONDITION_IDS) }).loose(),
  ]),
);

/** 概率分支（docs/64 §九.4 备选池「赌徒齿轮」）：weight 即相对概率。effects 用 lazy 自引用。 */
// 显式标注类型：effectSchema ⟷ chanceBranchSchema 互为引用，靠这行打断 TS 的推断环。
const chanceBranchSchema: z.ZodType<{ weight: number; effects: readonly unknown[] }> = z
  .object({
    weight: z.number().min(0),
    effects: z.array(z.lazy((): z.ZodTypeAny => effectSchema)).min(1),
  })
  .strict();

const effectSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("damage"),
      target: targetSchema.optional(),
      value: z.number().int().min(0),
      hits: z.number().int().min(1).optional(),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("block"),
      target: targetSchema.optional(),
      value: z.number().int().min(0),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("draw"), value: z.number().int().min(0), delayTurns: z.number().int().min(1).optional(), condition: conditionSchema.optional() }).strict(),
  z
    .object({
      kind: z.literal("heal"),
      target: targetSchema.optional(),
      value: z.number().int().min(0),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("applyBuff"),
      buff: z.enum(BUFF_IDS),
      stacks: z.number().int().min(0),
      duration: z.number().int().min(1).optional(),
      target: targetSchema.optional(),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("gainEnergy"), value: z.number().int().min(0), condition: conditionSchema.optional() }).strict(),
  z.object({ kind: z.literal("gainPollution"), value: z.number(), condition: conditionSchema.optional() }).strict(),
  z.object({ kind: z.literal("gainCharge"), value: z.number(), condition: conditionSchema.optional() }).strict(),
  z
    .object({
      kind: z.literal("gainCard"),
      /** "bloodCost" = 全池带血契代价的牌；数组 = 显式卡 id 列表 */
      pool: z.union([z.literal("bloodCost"), z.array(z.string().regex(ID_PATTERN)).min(1)]).optional(),
      count: z.number().int().min(1).optional(),
      value: z.number().int().min(0).optional(),
      /** 延迟 N 回合入手（甲方 2026-10-08，超械铁拳的「蓄力一回合」） */
      delayTurns: z.number().int().min(1).optional(),
      /** 生成物以升级面入场（超械铁拳升级版给升级「铁拳」） */
      upgraded: z.boolean().optional(),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("bankCharge"),
      /** 扣掉当前充能后，下回合还回「扣掉的层数 + value」（上发条改版） */
      value: z.number().int().min(0),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("spendCharge"),
      target: targetSchema.optional(),
      /** 每点充能的结算量 */
      value: z.number().int().min(0),
      /** 每点充能的结算方式（缺省 damage） */
      mode: z.enum(["damage", "block", "draw"]).optional(),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("clampCharge"),
      /** 充能上限：超过则平衡到该值 */
      value: z.number().int().min(1),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("chargeFromEnergy"),
      /** 在「当前能量」之上的额外加成（升级 +1） */
      value: z.number().int().min(0),
      /** 触发过载反噬时额外抽的牌数 */
      overloadDraw: z.number().int().min(0).optional(),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("spendPollution"),
      target: targetSchema.optional(),
      /** 每点污染的结算量 */
      value: z.number().int().min(0),
      mode: z.enum(["damage", "block", "draw"]).optional(),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("transferPollution"),
      target: targetSchema.optional(),
      /** N：自身污染 −2N，目标敌人 +N 蚀锈 */
      value: z.number().int().min(0),
      duration: z.number().int().min(1).optional(),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("consumeCorroding"),
      target: targetSchema.optional(),
      /** 每层蚀锈追加的伤害 */
      value: z.number().int().min(0),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("consumeBoons"),
      target: targetSchema.optional(),
      /** 每 1 层有利状态造成的伤害 */
      value: z.number().int().min(0),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("summon"),
      enemyId: z.string().regex(ID_PATTERN),
      count: z.number().int().min(1).optional(),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("destroyHand"),
      /** 销毁几张手牌（缺省 1；上限由 core 夹到手牌张数） */
      value: z.number().int().min(1),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      /** 随机弃手牌（docs/64 铁口粮）：缺省 1 张 */
      kind: z.literal("discard"),
      value: z.number().int().min(1),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      /** 充能减半（docs/64 熔炉之心）：向下取整，不经 changeCharge */
      kind: z.literal("halveCharge"),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("gainModifier"),
      valueKind: z.enum(VALUE_KINDS),
      op: z.enum(["add", "mul"]),
      value: z.number(),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      /** 概率分支（docs/64 §九.4 备选池「赌徒齿轮」）：按 weight 掷一次，结算命中分支 */
      kind: z.literal("chance"),
      options: z.array(chanceBranchSchema).min(1),
      condition: conditionSchema.optional(),
    })
    .strict(),
  z
    .object({
      /** 销毁全部手牌（电表倒转，甲方 2026-10-09）：每张换 chargePer 充能 / blockPer 格挡 */
      kind: z.literal("destroyHandAll"),
      chargePer: z.number().int().min(0).optional(),
      blockPer: z.number().int().min(0).optional(),
      condition: conditionSchema.optional(),
    })
    .strict(),
]);

const playSchema = z
  .object({
    handler: z.enum(CARD_HANDLER_IDS),
    params: z.record(z.string(), z.unknown()),
  })
  .strict();

/** 卡牌常驻能力（docs/29 §一②）：与遗物同构的 { timing, effects, once }。 */
const powerSchema = z
  .object({
    timing: z.enum(["onBattleStart", "onTurnStart", "onTurnEnd", "onPlay", "onHit", "onSell", "onBlock", "onGainCharge", "onPollutionMax", "onExhaust"]),
    effects: z.array(effectSchema).min(1),
    once: z.enum(["battle", "turn"]).optional(),
  })
  .strict();

const cardShape = {
  id: idSchema,
  class: z.enum(CARD_CLASSES),
  type: z.enum(CARD_TYPES),
  rarity: z.enum(CARD_RARITIES),
  cost: z.number().int().min(0).max(9),
  /** X 费（甲方 2026-10-08，红线运转）：费用 = 打牌前的当前能量，卡面显示「X」 */
  costX: z.boolean().optional(),
  /** 衍生物牌（甲方 2026-10-08，铁拳）：只在战斗中凭空生成，不进任何掉落池 */
  token: z.boolean().optional(),
  bloodCost: z.number().int().min(0).max(99).optional(),
  /** 固定充能代价（docs/51 §二）：与 bloodCost 同构的一笔资源成本 */
  chargeCost: z.number().int().min(1).max(99).optional(),
  keywords: z.array(z.enum(KEYWORD_IDS)).optional(),
  effects: z.array(effectSchema).optional(),
  unlockCondition: z.string().optional(),
  play: playSchema.optional(),
  power: powerSchema.optional(),
  upgraded: z
    .object({
      cost: z.number().int().min(0).max(9).optional(),
      /** 升级减代价（docs/51 §二 祭血狂热） */
      bloodCost: z.number().int().min(0).max(99).optional(),
      effects: z.array(effectSchema).optional(),
      play: playSchema.optional(),
      power: powerSchema.optional(),
      keywords: z.array(z.enum(KEYWORD_IDS)).optional(),
    })
    .strict()
    .optional(),
  art: z.string().optional(),
  i18n: z.string().optional(),
} as const;

export const cardSchema = z
  .object(cardShape)
  .strict()
  .refine((c) => c.effects !== undefined || c.play !== undefined || c.power !== undefined, {
    message: "卡牌必须至少有 effects / play / power 之一",
    path: ["effects"],
  });

export const enhancementSchema = z
  .object({
    id: idSchema,
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    appliesTo: z.array(z.string().regex(ID_PATTERN)).min(1),
    mutex: z.array(z.string().regex(ID_PATTERN)).optional(),
    handler: z.enum(ENHANCEMENT_HANDLER_IDS),
    params: z.record(z.string(), z.unknown()),
    i18n: z.string().optional(),
    /** 幕专属（docs/40 §七）：非空时不得进入其它幕奖励池 */
    actScope: z.string().optional(),
  })
  .strict();

/**
 * 事件效果（docs/27 §三；docs/54 §三 扩到 10 种）：只允许挂钩现有管线。
 * 六种新增全是局外（run 层）变更，不碰战斗结算。
 */
const eventEffectSchema = z
  .object({
    kind: z.enum([
      "hp",
      "hpPercent",
      "maxHp",
      "pollution",
      "gainRelic",
      "loseRelic",
      "gainCard",
      "removeCard",
      "upgradeRandom",
      "gainEnhancement",
    ]),
    value: z.number().int().optional(),
    rarity: z.enum(CARD_RARITIES).optional(),
    pool: z.array(z.string().regex(ID_PATTERN)).min(1).optional(),
    count: z.number().int().min(1).optional(),
    /** gainRelic / loseRelic 的遗物分级收窄（docs/66 批 3） */
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  })
  .strict();

/** 选项级条件（docs/54 §三 E6 / docs/55 Q3） */
const eventConditionSchema = z
  .object({
    kind: z.enum(["hpPercentAtLeast", "pollutionAtLeast", "loseableRelicAtLeast"]),
    value: z.number().min(0),
  })
  .strict();

const eventOutcomeSchema = z
  .object({ weight: z.number().min(0), i18n: z.string(), effects: z.array(eventEffectSchema) })
  .strict();

const eventOptionSchema = z
  .object({
    id: z.string().regex(ID_PATTERN),
    effects: z.array(eventEffectSchema).optional(),
    i18n: z.string().optional(),
    outcomes: z.array(eventOutcomeSchema).min(1).optional(),
    condition: eventConditionSchema.optional(),
  })
  .strict()
  // 允许「纯离开」选项（只有结果文案、无任何数值改动）
  .refine((o) => o.effects !== undefined || o.outcomes !== undefined || o.i18n !== undefined, {
    message: "事件选项必须至少有 effects / outcomes / i18n 之一",
    path: ["effects"],
  });

export const eventSchema = z
  .object({
    id: idSchema,
    i18n: z.string(),
    options: z.array(eventOptionSchema).min(2),
  })
  .strict();

export type EventJson = z.infer<typeof eventSchema>;

export const i18nSchema = z.record(z.string(), z.string());

export type CardJson = z.infer<typeof cardSchema>;
export type EnhancementJson = z.infer<typeof enhancementSchema>;

export { ENHANCEMENT_TIERS };

/** 意图定义（可递归：蓄力链 蓄 →（可再蓄）→ 释放，docs/18 Q1） */
export interface IntentJson {
  kind: "attack" | "defend" | "debuff" | "charge" | "summon" | "selfBuff" | "unknown";
  value?: number;
  hits?: number;
  buffId?: string;
  stacks?: number;
  duration?: number;
  /** 蓄力回合附带格挡（docs/18 Q3） */
  block?: number;
  /** Boss 例外：写死的释放值（docs/18 Q2） */
  releaseOverride?: number;
  thenIntent?: IntentJson;
  /** 召唤（docs/40 §五）：召唤物 id / 数量 / 可抽中上限 */
  enemyId?: string;
  count?: number;
  maxSummons?: number;
  /** 吸血比例（docs/60 §四 狂噬） */
  lifesteal?: number;
}

const intentBaseSchema = z
  .object({
    kind: z.enum(["attack", "defend", "debuff", "charge", "summon", "selfBuff", "unknown"]),
    value: z.number().int().min(0).optional(),
    hits: z.number().int().min(1).optional(),
    buffId: z.enum(BUFF_IDS).optional(),
    stacks: z.number().int().min(1).optional(),
    duration: z.number().int().min(1).optional(),
    block: z.number().int().min(1).optional(),
    releaseOverride: z.number().int().min(0).optional(),
    /** 召唤（docs/40 §五）：召唤物 id / 数量 / 可抽中上限 */
    enemyId: z.string().regex(ID_PATTERN).optional(),
    count: z.number().int().min(1).optional(),
    maxSummons: z.number().int().min(1).optional(),
    /** 吸血比例（docs/60 §四 狂噬）：按真实掉血回血给自己，0 < x ≤ 1 */
    lifesteal: z.number().gt(0).max(1).optional(),
  })
  .strict();

const intentDefSchema: z.ZodType<IntentJson> = z.lazy(() =>
  intentBaseSchema.extend({ thenIntent: intentDefSchema.optional() }),
);

const enemyIntentSchema = z
  .object({
    intent: intentDefSchema,
    weight: z.number().min(0),
    condition: conditionSchema.optional(),
    maxConsecutive: z.number().int().min(1).optional(),
    /** 节拍技（docs/47 §三.2）：回合数 %N==0 时强制顶替 */
    everyTurns: z.number().int().min(1).optional(),
    /** 追击条件（docs/47 §三.3）：玩家身上该 buff 层数 ≥ minStacks 才可抽中 */
    playerBuff: z
      .object({ buffId: z.enum(BUFF_IDS), minStacks: z.number().int().min(1) })
      .strict()
      .optional(),
    /** 整场一次（docs/60 §七 虚化）：抽中过一次后不再进入候选池 */
    once: z.boolean().optional(),
  })
  .strict();

export const enemySchema = z
  .object({
    id: idSchema,
    i18n: z.string(),
    maxHp: z.number().int().min(1),
    intents: z.array(enemyIntentSchema).min(1),
    /** 亡语（docs/16 P2.2）：死亡清理后结算 */
    onDeath: z.array(effectSchema).optional(),
    interruptImmune: z.boolean().optional(),
    /** 眩晕抗性（docs/46 §3.5）：精英 / Boss 首次被眩晕后本场免疫后续 */
    stunResistant: z.boolean().optional(),
    /** 转阶段保护（docs/60 §四 锈喉）：跨过 50% 的那一次伤害免伤 99%，每场一次 */
    phaseGuard: z.boolean().optional(),
    /** 开场状态（docs/47 §三.4）：战斗开始即挂在自己身上 */
    startBuffs: z
      .array(z.object({ buffId: z.enum(BUFF_IDS), stacks: z.number().int().min(1) }).strict())
      .optional(),
    /** 分裂亡语（docs/47 §三.4）：**M3 锁定**，正式数据出现即报错 */
    onDeathSplit: z
      .object({ enemyId: z.string().regex(ID_PATTERN), count: z.number().int().min(1) })
      .strict()
      .optional(),
  })
  .strict();

export const mapNodeSchema = z
  .object({
    id: idSchema,
    kind: z.enum(NODE_KINDS),
    enemies: z.array(z.string().regex(ID_PATTERN)).optional(),
    encounters: z
      .array(z.object({ enemies: z.array(z.string().regex(ID_PATTERN)).min(1), weight: z.number().min(0) }).strict())
      .min(1)
      .optional(),
    events: z.array(z.string().regex(ID_PATTERN)).min(1).optional(),
    event: z.string().regex(ID_PATTERN).optional(),
    i18n: z.string().optional(),
  })
  .strict();

/** 幕内敌人属性倍率（docs/65 §二 / docs/66 §4.1）：正数，缺省不写 = ×1。 */
const statMultSchema = z.object({ hp: z.number().positive(), damage: z.number().positive() }).strict();

/** 分支地图层模板（docs/16 5.4）：width=1 必经/汇合，width≥2 分支候选。 */
const mapLayerSpecSchema = z
  .object({
    id: idSchema,
    width: z.number().int().min(1).max(4),
    kinds: z.array(z.enum(NODE_KINDS)).min(1),
    weights: z.record(z.string(), z.number().min(0)).optional(),
    elitePool: z.array(z.string().regex(ID_PATTERN)).min(1).optional(),
    encounters: z
      .array(z.object({ enemies: z.array(z.string().regex(ID_PATTERN)).min(1), weight: z.number().min(0) }).strict())
      .min(1)
      .optional(),
    events: z.array(z.string().regex(ID_PATTERN)).min(1).optional(),
    enemies: z.array(z.string().regex(ID_PATTERN)).min(1).optional(),
    /** 骨架层（docs/66 §3.2 门禁兼容实装）：该层必现一个指定稀有节点 */
    pin: z.enum(["elite", "rest"]).optional(),
    /** 本层敌人属性倍率（docs/66 §4.1：三幕 l7 满档） */
    statMult: statMultSchema.optional(),
    i18n: z.string().optional(),
  })
  .strict();

export const actSchema = z
  .object({
    id: idSchema,
    i18n: z.string(),
    /** 本幕可选职业 id 列表（docs/16 5.1） */
    classes: z.array(z.string().regex(ID_PATTERN)).min(1),
    /** 全局节点类型权重（docs/14 Q17） */
    weights: z.record(z.string(), z.number().min(0)),
    /** 本幕节点文案（按 kind，docs/40 §三补） */
    nodeI18n: z.record(z.string(), z.string()).optional(),
    /** 幕级战斗规则（docs/66）：id 走白名单，params 为数值表 */
    rules: z
      .array(
        z
          .object({
            id: z.enum(ACT_RULE_IDS),
            params: z.record(z.string(), z.number()).optional(),
          })
          .strict(),
      )
      .optional(),
    /** 本幕敌人属性倍率兜底（docs/66 §4.1）：第三幕 ×1.15/×1.1 */
    statMult: statMultSchema.optional(),
    /** 分支地图层模板（至少：入口 + 精英 + Boss） */
    layers: z.array(mapLayerSpecSchema).min(3),
  })
  .strict();

/** 职业定义（docs/16 5.1）：player / startDeck / startRelics 自成一档。 */
export const classSchema = z
  .object({
    id: idSchema,
    i18n: z.string(),
    player: z.object({ maxHp: z.number().int().min(1), energy: z.number().int().min(0) }).strict(),
    startDeck: z.array(z.string().regex(ID_PATTERN)).min(1),
    startRelics: z.array(z.string().regex(ID_PATTERN)).optional(),
    unlock: z.string().optional(),
  })
  .strict();

export type ClassJson = z.infer<typeof classSchema>;

/** 职业特性（docs/58 §二）：id / 归属职业 / 文案 / handler / params，机制逻辑在 TS 侧。 */
export const traitSchema = z
  .object({
    id: idSchema,
    classId: z.string().regex(ID_PATTERN),
    i18n: z.string(),
    handler: z.enum(TRAIT_HANDLER_IDS),
    params: z.record(z.string(), z.unknown()),
  })
  .strict();

export type TraitJson = z.infer<typeof traitSchema>;

export type EnemyJson = z.infer<typeof enemySchema>;
export type ActJson = z.infer<typeof actSchema>;
export const relicSchema = z
  .object({
    id: idSchema,
    i18n: z.string(),
    timing: z.enum(["onBattleStart", "onTurnStart", "onTurnEnd", "onPlay", "onHit", "onSell", "onBlock", "onGainCharge", "onPollutionMax", "onExhaust", "onBattleWin"]),
    /** 数据驱动效果；规则件（docs/64 §三）可以只挂 handler 而没有 effects */
    effects: z.array(effectSchema).min(1).optional(),
    once: z.enum(["battle", "turn"]).optional(),
    /** 掉落池分级（docs/38 §一）：缺省 = 身份件，不入池 */
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    unlockCondition: z.string().optional(),
    /** 规则 handler（docs/64 §三）：机制逻辑在 relic-handler.ts，JSON 只传参 */
    handler: z.enum(RELIC_HANDLER_IDS).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((r) => (r.effects && r.effects.length > 0) || r.handler !== undefined, {
    message: "遗物必须至少有 effects 或 handler 之一（docs/64 §三）",
  });

export type RelicJson = z.infer<typeof relicSchema>;