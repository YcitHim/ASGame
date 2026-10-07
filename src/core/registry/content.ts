/**
 * core/registry · 内容目录（ContentDb）
 *
 * data/*.json 经 content-validator 校验后，在应用启动时装入这里。
 * core 只认这些类型，不读文件系统、不 import UI（G3）。
 */
import type { ModifierOp, ValueKind } from "../pipeline";
import type { BuffId, CardHandlerId, CardRarity, CardType, ConditionId, EnhancementHandlerId, KeywordId, TargetId } from "./ids";

export interface TargetRef {
  readonly type: TargetId;
}

export type ConditionNode =
  | { readonly type: "and"; readonly of: readonly ConditionNode[] }
  | { readonly type: "or"; readonly of: readonly ConditionNode[] }
  | { readonly type: "not"; readonly of: ConditionNode }
  | { readonly type: ConditionId } & Record<string, unknown>;

export interface CardEffect {
  readonly kind:
    | "damage"
    | "block"
    | "draw"
    | "heal"
    | "applyBuff"
    | "gainEnergy"
    | "gainPollution"
    | "gainCharge"
    /** 写入本场临时修饰层（docs/16 P3.2「血锈光环」）：战斗内持续、随战斗结束消失 */
    | "gainModifier"
    /** 消耗全部充能（docs/27 §二 C2 / docs/29 §二⑥）：每点充能按 mode 结算，随后清零 */
    | "spendCharge"
    /** 充能封顶（压力表）：超过 value 时平衡回 value */
    | "clampCharge"
    /**
     * 充能 = 出牌前的当前能量 + value（红线运转，玩家反馈）。
     * 若这一步把充能推过上限（过载反噬），再抽 overloadDraw 张牌。
     */
    | "chargeFromEnergy"
    /** 消耗全部污染（docs/38 §二 B-2）：每点污染按 mode 结算，随后清零 */
    | "spendPollution"
    /** 污染转移（docs/38 §二 B-2）：自身 −2N，目标敌人 +N 蚀锈 */
    | "transferPollution"
    /** 兑现蚀锈（docs/38 §二 B-2「终点站」）：消耗目标全部蚀锈，每层追加 value 伤害 */
    | "consumeCorroding"
    /**
     * 兑现自身「有利状态」（血链重做）：把身上**全部加持**（力量/再生/坚韧/荆棘/回血印记…）
     * 与**充能**一起消耗，每 1 层造成 value 点伤害。
     * 负面状态（虚弱/胆怯/污染/蚀锈/灼烧/冰缓/颠倒/眩晕）不算也不消耗——它们是敌人给的，
     * 不是你的筹码。伤害先扣状态再结算，避免力量自己给自己加成（同一批筹码记两次）。
     */
    | "consumeBoons"
    /** 召唤（docs/40 §五）：亡语召唤用（tide_swarm 死亡生虫） */
    | "summon";
  readonly target?: TargetRef;
  readonly value?: number;
  readonly hits?: number;
  readonly buff?: BuffId;
  /** 强度型=层数；计时型=回合数（策划 Q1） */
  readonly stacks?: number;
  /** 计时型的显式回合数覆盖（再生等 stacksAndTurns 型） */
  readonly duration?: number;
  /** 仅对该效果生效的条件（如 HP<50% 时抽牌） */
  readonly condition?: ConditionNode;
  /** 仅 gainModifier：目标数值种类与运算 */
  readonly valueKind?: ValueKind;
  readonly op?: ModifierOp;
  /** spendCharge / spendPollution：每点的结算方式（缺省 damage） */
  readonly mode?: "damage" | "block" | "draw";
  /** 仅 summon：召唤物定义 id 与数量 */
  readonly enemyId?: string;
  readonly count?: number;
  /** 仅 chargeFromEnergy：触发过载时额外抽的牌数 */
  readonly overloadDraw?: number;
}

/**
 * 职业定义（docs/16 5.1）：player / startDeck / startRelics 从 act 抽出，
 * 新增职业 = 只加 JSON。act 只声明本幕开放哪些职业。
 */
export interface ClassDefinition {
  readonly id: string;
  readonly i18n: string;
  readonly player: { readonly maxHp: number; readonly energy: number };
  readonly startDeck: readonly string[];
  readonly startRelics?: readonly string[];
  /** 解锁条件：default = 初始可用；first_boss_clear 等由 meta 层判定（docs/29 §三⑨） */
  readonly unlock?: string;
}

export interface CardUpgrade {
  readonly cost?: number;
  /** 升级减代价（docs/51 §二 祭血狂热：血契 3 → 2）——升级口径是「减代价」而非「加量」 */
  readonly bloodCost?: number;
  readonly effects?: readonly CardEffect[];
  readonly play?: CardPlayHandler;
  readonly keywords?: readonly KeywordId[];
  readonly power?: CardPower;
}

/**
 * 卡牌能力（power）的常驻触发（docs/29 §一②）：打出后记入玩家 powers 列表，
 * 之后按 timing 派发 effects。与遗物同构，但挂在卡牌实例上（升级版可覆盖）。
 */
export interface CardPower {
  readonly timing: TriggerTiming;
  readonly effects: readonly CardEffect[];
  /** 触发次数限制：battle = 整场一次；turn = 每回合一次；缺省 = 每次触发 */
  readonly once?: "battle" | "turn";
}

export interface CardPlayHandler {
  readonly handler: CardHandlerId;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface CardDefinition {
  readonly id: string;
  readonly class: string;
  readonly type: CardType;
  readonly rarity: CardRarity;
  readonly cost: number;
  readonly bloodCost?: number;
  /**
   * 打出前需支付的**充能**代价（docs/51 §二 回压阀 / 齿轮过驳）。
   * 与 `bloodCost` 同构：卡面费用之外的一笔固定资源成本，不足则打不出去。
   * 注意：`spendCharge` 是「消耗全部充能按每点结算」，跟这个不是一回事。
   */
  readonly chargeCost?: number;
  readonly keywords?: readonly KeywordId[];
  readonly effects?: readonly CardEffect[];
  readonly play?: CardPlayHandler;
  /** 常驻触发（docs/29 §一②「动能电池 / 炉渣装甲」）：打出后本场生效 */
  readonly power?: CardPower;
  readonly upgraded?: CardUpgrade;
  readonly art?: string;
  readonly i18n?: string;
  /** 入池解锁条件（docs/23 §9）：0.5 一律 "none"；P6 meta 上线时改为解锁式 */
  readonly unlockCondition?: string;
}

export interface IntentDefinition {
  readonly kind: "attack" | "defend" | "debuff" | "charge" | "summon" | "selfBuff" | "unknown";
  /**
   * 普通招式 = 伤害/数值；蓄力 = **每层一次性增幅值**（docs/18 Q2）。
   * 蓄力链的释放值 = 普攻基准 + 蓄力值 × 层数，释放即消耗、不残留。
   */
  readonly value?: number;
  readonly hits?: number;
  readonly buffId?: BuffId;
  readonly stacks?: number;
  readonly duration?: number;
  /** 蓄力回合附带的格挡（docs/18 Q3「蓄力并架起 N 点格挡」） */
  readonly block?: number;
  /** Boss 例外：写死的释放值，绕过叠加公式（docs/18 Q2） */
  readonly releaseOverride?: number;
  /**
   * 蓄力链的下一环：蓄 →（可再蓄）→ 释放。末端必须是 attack（docs/18 Q1）；
   * 链长按敌型区分（法术 2 / 物理 1），不写无限链。
   */
  readonly thenIntent?: IntentDefinition;
  /** 召唤意图（docs/40 §五）：召唤哪一个敌人、几只（count 本幕恒为 1） */
  readonly enemyId?: string;
  readonly count?: number;
  /**
   * 可抽中条件（docs/40 §五-3）：场上该召唤物数量 < maxSummons 时才可被抽中；
   * 抽中后校验不满足则按 §五-2 重抽，不做成 condition 新类型。
   */
  readonly maxSummons?: number;
}

export interface EnemyIntentEntry {
  readonly intent: IntentDefinition;
  readonly weight: number;
  readonly condition?: ConditionNode;
  /** 同一意图最多连续出现次数（0.1 读招体验） */
  readonly maxConsecutive?: number;
  /**
   * 节拍技（docs/47 §三.2）：战斗回合数 %N==0 时**强制顶替**本次抽取（优先于 weight），
   * 同回合多条命中取数组序第一条，自身仍受 maxConsecutive 约束——
   * 把「大招」从 weight 玄学变成玩家数得出来的节拍。
   */
  readonly everyTurns?: number;
  /**
   * 追击条件（docs/47 §三.3）：玩家身上该 buff 层数 ≥ minStacks 时才可被抽中，
   * 不满足按召唤同款规则重抽（docs/40 §五.2 先例）。
   */
  readonly playerBuff?: { readonly buffId: BuffId; readonly minStacks: number };
}

/** 开场状态（docs/47 §三.4）：战斗开始即挂在敌人自己身上。 */
export interface StartBuff {
  readonly buffId: BuffId;
  readonly stacks: number;
}

/** 分裂亡语（docs/47 §三.4，M3 已解锁）：死亡时原地召唤 enemyId × count，分裂物不再分裂。 */
export interface DeathSplit {
  readonly enemyId: string;
  readonly count: number;
}

/** 敌人 JSON 的原始形状（两个装载器共用：新增字段只在这里映射，避免静默丢字段）。 */
export interface RawEnemyDefinition {
  readonly id: string;
  readonly maxHp: number;
  readonly intents: readonly EnemyIntentEntry[];
  readonly startBuffs?: readonly StartBuff[];
  readonly onDeathSplit?: DeathSplit;
  readonly onDeath?: readonly CardEffect[];
  /** 免疫断链（docs/38 §三 C-1）：Boss 例外条款，与 releaseOverride 同一登记处 */
  readonly interruptImmune?: boolean;
  /** 眩晕抗性（docs/46 §3.5）：精英 / Boss 首次被眩晕后，本场战斗免疫后续眩晕 */
  readonly stunResistant?: boolean;
}

/** 由 JSON 原始对象 + 解析后的显示名构造敌人定义。 */
export function buildEnemyDefinition(raw: RawEnemyDefinition, name: string): EnemyDefinition {
  return {
    id: raw.id,
    name,
    maxHp: raw.maxHp,
    intents: raw.intents,
    ...(raw.startBuffs ? { startBuffs: raw.startBuffs } : {}),
    ...(raw.onDeathSplit ? { onDeathSplit: raw.onDeathSplit } : {}),
    ...(raw.onDeath ? { onDeath: raw.onDeath } : {}),
    ...(raw.interruptImmune ? { interruptImmune: true } : {}),
    ...(raw.stunResistant ? { stunResistant: true } : {}),
  };
}

export interface EnemyDefinition {
  readonly id: string;
  readonly name: string;
  readonly maxHp: number;
  readonly intents: readonly EnemyIntentEntry[];
  /** 开场状态（docs/47 §三.4）：战斗开始即挂在敌人自己身上 */
  readonly startBuffs?: readonly StartBuff[];
  /** 分裂亡语（docs/47 §三.4，M3 已解锁）：死亡时原地召唤 enemyId × count */
  readonly onDeathSplit?: DeathSplit;
  /** 亡语（docs/16 P2.2）：该单位死亡并完成死亡清理后结算的效果 */
  readonly onDeath?: readonly CardEffect[];
  /** 免疫断链（docs/38 §三 C-1）：蓄力被虚弱/易伤命中时不被打断 */
  readonly interruptImmune?: boolean;
  /** 眩晕抗性（docs/46 §3.5）：精英 / Boss 首次被眩晕后，本场战斗免疫后续眩晕 */
  readonly stunResistant?: boolean;
}

export interface EnhancementDefinition {
  readonly id: string;
  readonly tier: 1 | 2 | 3;
  readonly appliesTo: readonly string[];
  readonly mutex?: readonly string[];
  readonly handler: EnhancementHandlerId;
  readonly params: Readonly<Record<string, unknown>>;
  readonly i18n?: string;
  /** 幕专属强化（docs/40 §七）：actScope 非空时不得出现在其它幕的奖励池 */
  readonly actScope?: string;
}

/** 难度档（docs/36 T2）：普通 / 锈蚀。 */
export type RunDifficulty = "normal" | "rust";
export const DIFFICULTY_PARAMS: Record<
  RunDifficulty,
  { enemyHpMul: number; enemyDamageMul: number; relicChoices: number }
> = {
  normal: { enemyHpMul: 1, enemyDamageMul: 1, relicChoices: 3 },
  rust: { enemyHpMul: 1.2, enemyDamageMul: 1.1, relicChoices: 2 },
};

/** 地图节点类型（0.1 用到的子集 + event 预留）。 */
export const NODE_KINDS = ["battle", "elite", "rest", "altar", "reward", "boss", "event"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export interface EncounterEntry {
  readonly enemies: readonly string[];
  readonly weight: number;
}

/**
 * 随机事件效果（docs/27 §三 / docs/16 4.4；docs/54 §三 扩展到 10 种）。
 *
 * 新增六种（E1~E5）全部是**局外（run 层）变更**，与战斗结算零交集：
 * hpPercent 按上限缩放、maxHp 改上限、removeCard 开删牌渠道、upgradeRandom 补升级渠道、
 * loseRelic 让遗物反向兑血。
 */
export type EventEffectKind =
  | "hp"
  | "hpPercent"
  | "maxHp"
  | "pollution"
  | "gainRelic"
  | "loseRelic"
  | "gainCard"
  | "removeCard"
  | "upgradeRandom"
  | "gainEnhancement";

export interface EventEffect {
  readonly kind: EventEffectKind;
  /**
   * hp：正=回复、负=失去（写死点数，军规 2 只给小额的剧情性收支）；
   * hpPercent：按**最大生命百分比**取整（-15 = 失去 15% 上限，向下取整、最低 1）；
   * maxHp：±最大生命上限（当前 HP 同额增减）；
   * pollution：增减量。
   */
  readonly value?: number;
  /** gainCard：按稀有度抽池（与 pool 二选一） */
  readonly rarity?: CardRarity;
  /** gainCard：显式卡池 */
  readonly pool?: readonly string[];
  /** gainCard / loseRelic：抽几件（缺省 1） */
  readonly count?: number;
}

/**
 * 选项级条件（docs/54 §三 E6）：不满足 → 置灰 + 注明缺什么。
 *
 * 计数口径与效果池必须同源（docs/55 Q3）：`loseableRelicAtLeast` 数的是
 * **可典当遗物**（T1/T2 − 本局职业身份件），也就是 loseRelic 真正会抽的那一池。
 */
export type EventConditionKind = "hpPercentAtLeast" | "pollutionAtLeast" | "loseableRelicAtLeast";

export interface EventCondition {
  readonly kind: EventConditionKind;
  /** 阈值（hpPercentAtLeast 为百分比点数） */
  readonly value: number;
}

/** 随机结果（赌博式事件用）：weight + 结果文案 key + 效果。 */
export interface EventOutcome {
  readonly weight: number;
  readonly i18n: string;
  readonly effects: readonly EventEffect[];
}

export interface EventOption {
  /** 选项 id（i18n 后缀：event.<id>.opt.<optionId>.label / .result） */
  readonly id: string;
  /** 固定结果 */
  readonly effects?: readonly EventEffect[];
  /** 固定结果文案 key（随机结果时由 outcome.i18n 提供） */
  readonly i18n?: string;
  /** 随机结果（与 effects 二选一） */
  readonly outcomes?: readonly EventOutcome[];
  /** 门槛（docs/54 E6）：不满足时选项置灰，玩家仍看得见代价与收益 */
  readonly condition?: EventCondition;
}

export interface EventDefinition {
  readonly id: string;
  readonly i18n: string;
  readonly options: readonly EventOption[];
}

/**
 * 分支地图的「层模板」（docs/16 5.4 / docs/14 Q17）。
 * 运行时由 generateActMap 按种子实例化成 MapLayer[]：
 * width=1 为必经/汇合点，width≥2 为该层二选一的分支候选。
 */
export interface MapLayerSpec {
  readonly id: string;
  /** 声明的层宽：l0/l8/l9 = 1，中段 2~4（docs/48 §3.1 修订 1）。实际宽度由生成器按种子掷 */
  readonly width: number;
  /** 本层允许生成的节点类型；实际类型按 weights 抽取 */
  readonly kinds: readonly NodeKind[];
  /** 本层类型权重覆盖（缺省用 act 的全局权重） */
  readonly weights?: Readonly<Record<string, number>>;
  /** battle 节点的遭遇池（docs/29 §一③） */
  readonly encounters?: readonly EncounterEntry[];
  /** event 节点的事件池 */
  readonly events?: readonly string[];
  /** 写死敌人（width=1 的精英 / Boss 层用） */
  readonly enemies?: readonly string[];
  /** 精英池（docs/40 §三）：elite 层按种子池抽，同幕双精英不重复 */
  readonly elitePool?: readonly string[];
  /** 节点文案覆盖（缺省用 node.<kind>） */
  readonly i18n?: string;
}

export interface MapNode {
  readonly id: string;
  readonly kind: NodeKind;
  /** 层内列坐标 0~3（docs/48 §3.1 修订 1）：DAG 生成时写入，UI 按列排布 */
  readonly col?: number;
  /** battle / elite / boss 节点的敌人 id 列表 */
  readonly enemies?: readonly string[];
  /** 节点副标题（可选，i18n key） */
  readonly i18n?: string;
  /** 遭遇池（docs/29 §一③）：同种子同遭遇；缺省回落到 enemies */
  readonly encounters?: readonly EncounterEntry[];
  /** 事件节点：事件池 id（docs/27 §三），同种子抽一个；缺省遍历全部事件 */
  readonly events?: readonly string[];
  /** 事件节点：写死单个事件 id */
  readonly event?: string;
}

export interface ActDefinition {
  readonly id: string;
  readonly i18n: string;
  /** 本幕可选职业 id 列表（docs/16 5.1） */
  readonly classes: readonly string[];
  /** 全局节点类型权重（普40 / 精15 / 休15 / 祭15 / 事15，docs/14 Q17） */
  readonly weights: Readonly<Record<string, number>>;
  /** 本幕节点文案（按 kind，docs/40 §三补）：缺省用通用 node.<kind> */
  readonly nodeI18n?: Readonly<Record<string, string>>;
  /** 分支地图层模板（docs/16 5.4）：顺序即推进顺序，层内候选按种子生成 */
  readonly layers: readonly MapLayerSpec[];
}

/** 触发器时机（triggers README 的 v0 时机表）。 */
export type TriggerTiming =
  | "onBattleStart"
  | "onTurnStart"
  | "onTurnEnd"
  | "onPlay"
  | "onHit"
  | "onSell"
  /** 获得格挡时（docs/29 §一②「动能电池 / 炉渣装甲」） */
  | "onBlock"
  /** 获得充能时（docs/29 §二⑥「飞升齿轮」） */
  | "onGainCharge"
  /** 污染即将触顶（docs/38 §二 B-3「九十九」）：在反噬判定前派发，效果可把污染压回 99 */
  | "onPollutionMax";

/** 遗物分级（docs/37 §一.2 / docs/38 §一）：1 起始池，2 常规池，3 稀有池。 */
export type RelicTier = 1 | 2 | 3;

export interface RelicDefinition {
  readonly id: string;
  readonly i18n: string;
  readonly timing: TriggerTiming;
  readonly effects: readonly CardEffect[];
  /** 触发次数限制：battle = 整场一次；turn = 每回合一次；缺省 = 每次时机都触发 */
  readonly once?: "battle" | "turn";
  /**
   * 进入哪个掉落池（docs/38 §一 A-1）：T1 起始池（随身遗物自选）/ T2 精英池 / T3 Boss 稀有池。
   * **缺省 = 身份件**，不参与任何掉落池。
   */
  readonly tier?: RelicTier;
  /** 入池解锁条件（docs/36 T1）：缺省 / "none" = 默认可用；其余由 meta 层判定 */
  readonly unlockCondition?: string;
}

export interface ContentDb {
  readonly cards: ReadonlyMap<string, CardDefinition>;
  readonly enemies: ReadonlyMap<string, EnemyDefinition>;
  readonly enhancements: ReadonlyMap<string, EnhancementDefinition>;
  readonly relics: ReadonlyMap<string, RelicDefinition>;
  readonly events: ReadonlyMap<string, EventDefinition>;
  readonly classes: ReadonlyMap<string, ClassDefinition>;
}

export function createContentDb(partial: Partial<ContentDb> = {}): ContentDb {
  return {
    cards: partial.cards ?? new Map(),
    enemies: partial.enemies ?? new Map(),
    enhancements: partial.enhancements ?? new Map(),
    relics: partial.relics ?? new Map(),
    events: partial.events ?? new Map(),
    classes: partial.classes ?? new Map(),
  };
}

export function emptyContent(): ContentDb {
  return createContentDb();
}