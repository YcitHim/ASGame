import { z } from "zod";
import { NODE_KINDS } from "../../../src/core/registry/content";
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
  TARGET_IDS,
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
  z.object({ kind: z.literal("draw"), value: z.number().int().min(0), condition: conditionSchema.optional() }).strict(),
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
      kind: z.literal("gainModifier"),
      valueKind: z.enum(VALUE_KINDS),
      op: z.enum(["add", "mul"]),
      value: z.number(),
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

const cardShape = {
  id: idSchema,
  class: z.enum(CARD_CLASSES),
  type: z.enum(CARD_TYPES),
  rarity: z.enum(CARD_RARITIES),
  cost: z.number().int().min(0).max(9),
  bloodCost: z.number().int().min(0).max(99).optional(),
  keywords: z.array(z.enum(KEYWORD_IDS)).optional(),
  effects: z.array(effectSchema).optional(),
  unlockCondition: z.string().optional(),
  play: playSchema.optional(),
  upgraded: z
    .object({
      cost: z.number().int().min(0).max(9).optional(),
      effects: z.array(effectSchema).optional(),
      play: playSchema.optional(),
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
  .refine((c) => c.effects !== undefined || c.play !== undefined, {
    message: "卡牌必须至少有 effects 或 play 之一",
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
  })
  .strict();

export const i18nSchema = z.record(z.string(), z.string());

export type CardJson = z.infer<typeof cardSchema>;
export type EnhancementJson = z.infer<typeof enhancementSchema>;

export { ENHANCEMENT_TIERS };

/** 意图定义（可递归：蓄力链 蓄 →（可再蓄）→ 释放，docs/18 Q1） */
export interface IntentJson {
  kind: "attack" | "defend" | "debuff" | "charge" | "unknown";
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
}

const intentBaseSchema = z
  .object({
    kind: z.enum(["attack", "defend", "debuff", "charge", "unknown"]),
    value: z.number().int().min(0).optional(),
    hits: z.number().int().min(1).optional(),
    buffId: z.enum(BUFF_IDS).optional(),
    stacks: z.number().int().min(1).optional(),
    duration: z.number().int().min(1).optional(),
    block: z.number().int().min(1).optional(),
    releaseOverride: z.number().int().min(0).optional(),
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
  })
  .strict();

export const mapNodeSchema = z
  .object({
    id: idSchema,
    kind: z.enum(NODE_KINDS),
    enemies: z.array(z.string().regex(ID_PATTERN)).optional(),
    i18n: z.string().optional(),
  })
  .strict();

export const actSchema = z
  .object({
    id: idSchema,
    i18n: z.string(),
    player: z.object({ maxHp: z.number().int().min(1), energy: z.number().int().min(0) }).strict(),
    startDeck: z.array(z.string().regex(ID_PATTERN)).min(1),
    startRelics: z.array(z.string().regex(ID_PATTERN)).optional(),
    map: z.array(mapNodeSchema).min(1),
  })
  .strict();

export type EnemyJson = z.infer<typeof enemySchema>;
export type ActJson = z.infer<typeof actSchema>;
export const relicSchema = z
  .object({
    id: idSchema,
    i18n: z.string(),
    timing: z.enum(["onBattleStart", "onTurnStart", "onTurnEnd", "onPlay", "onHit", "onSell"]),
    effects: z.array(effectSchema).min(1),
    once: z.enum(["battle", "turn"]).optional(),
  })
  .strict();

export type RelicJson = z.infer<typeof relicSchema>;