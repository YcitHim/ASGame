/**
 * core/map/event · 随机事件结算（docs/27 §三 / docs/16 4.4）
 *
 * 纯函数：给定 事件定义 + 选项 + 种子，产出「发生了什么」。
 * 局外状态（HP / 污染 / 卡组 / 遗物）由调用方（run store）按返回值写回；
 * 事件 RNG 走独立的 event 流，同种子同结果（ADR-006）。
 */
import type {
  ContentDb,
  EventCondition,
  EventDefinition,
  EventEffect,
} from "../registry/content";
import { Rng, type RngStream } from "../rng";
import { NEUTRAL_CLASS, pickPoolSide, usableForClass } from "./pool";

export interface EventResolution {
  readonly optionId: string;
  /** 命中的随机结果下标；固定结果时为 -1 */
  readonly outcomeIndex: number;
  /** 结果文案 i18n key */
  readonly i18n: string;
  readonly hpDelta: number;
  /** 最大生命上限的变化（docs/54 E4）；调用方按「当前 HP 同额」写回 */
  readonly maxHpDelta: number;
  readonly pollutionDelta: number;
  readonly relicIds: readonly string[];
  readonly loseRelicIds: readonly string[];
  readonly cardIds: readonly string[];
  /** 玩家要自选删一张牌（docs/54 E2）：UI 弹出卡组选择，选完再继续 */
  readonly removeCard: boolean;
  /** 随机升级命中的卡组下标（docs/54 E3）；-1 = 没有可升级的牌 */
  readonly upgradeIndex: number;
  /** 是否开启「强化三选一」（E2-A，docs/27 §三） */
  readonly gainEnhancement: boolean;
}

export interface EventResolveContext {
  readonly seed: number;
  readonly ownedRelics: readonly string[];
  /** 本局职业：抽卡时做职业池隔离（缺省不过滤，兼容旧测试） */
  readonly classId?: string;
  /** 已解锁内容 id；解锁式内容未解锁不入池（docs/36 T1） */
  readonly unlocked?: readonly string[];
  /** 最大生命（hpPercent 的唯一分母，docs/54 E1） */
  readonly maxHp?: number;
  /** 卡组里**可升级**的下标（未升级，docs/54 E3）；缺省视为没有可升级的牌 */
  readonly deckUpgradeable?: readonly number[];
  /** 当前 HP / 污染（docs/54 E6 条件判定；缺省不做条件判定） */
  readonly hp?: number;
  readonly pollution?: number;
  /** 本局职业身份件（docs/55 Q1：loseRelic 必须排除它们） */
  readonly identityRelics?: readonly string[];
}

/** 选项条件的判定输入（docs/54 E6）：UI 与结算共用同一份口径。 */
export interface EventConditionContext {
  readonly hp: number;
  readonly maxHp: number;
  readonly pollution: number;
  /** 持有遗物总数 */
  readonly relicCount: number;
  /** 可典当遗物数（T1/T2 − 本局职业身份件）——与 loseRelic 的抽取池同源，docs/55 Q3 */
  readonly loseableRelicCount: number;
}

/**
 * loseRelic 的抽取池（docs/55 Q1）：**T1/T2 − 本局职业身份件**。
 *
 * 身份件不是装备是器官——当掉它不是「付出代价」，是职业幻想当场解体，
 * 玩家读不懂也防不住（血械没了卖血引擎，卖血牌全变纯自残）。血泵/压力表是 T1 池件，
 * 不属于身份件，照当——那才是「玩家自己走进当铺、自己点的当货」的合法重戏剧。
 */
export function loseableRelicPool(
  content: ContentDb,
  ownedRelics: readonly string[],
  identityRelics: readonly string[] = [],
): string[] {
  return [...ownedRelics]
    .filter((id) => {
      const tier = content.relics.get(id)?.tier;
      return (tier === 1 || tier === 2) && !identityRelics.includes(id);
    })
    .sort();
}

/**
 * 选项条件是否满足（docs/54 §三 E6）。
 * hpPercentAtLeast 用**向下取整**的当前百分比与阈值比——和玩家在顶栏看到的整数一致，
 * 避免「显示 40% 却判定 39.6% 不达标」这类看不见的边界。
 */
export function checkEventCondition(
  condition: EventCondition | undefined,
  ctx: EventConditionContext,
): boolean {
  if (!condition) return true;
  switch (condition.kind) {
    case "hpPercentAtLeast": {
      const pct = ctx.maxHp > 0 ? Math.floor((ctx.hp / ctx.maxHp) * 100) : 0;
      return pct >= condition.value;
    }
    case "pollutionAtLeast":
      return ctx.pollution >= condition.value;
    case "loseableRelicAtLeast":
      return ctx.loseableRelicCount >= condition.value;
    default:
      return true;
  }
}

/** 条件当前值（UI 用它把「当前多少」写进置灰提示；与 check 同源）。 */
export function eventConditionCurrent(condition: EventCondition, ctx: EventConditionContext): number {
  switch (condition.kind) {
    case "hpPercentAtLeast":
      return ctx.maxHp > 0 ? Math.floor((ctx.hp / ctx.maxHp) * 100) : 0;
    case "pollutionAtLeast":
      return ctx.pollution;
    case "loseableRelicAtLeast":
      return ctx.loseableRelicCount;
    default:
      return 0;
  }
}

/** 百分比 HP 换算：向下取整、最低 1（docs/54 军规 2）。 */
export function percentHpDelta(maxHp: number, percent: number): number {
  const magnitude = Math.max(1, Math.floor((Math.max(0, maxHp) * Math.abs(percent)) / 100));
  return percent < 0 ? -magnitude : magnitude;
}

/** 卡池按稀有度权重（仅用于「按稀有度权重」的显式池抽取，program 默认值）。 */
const RARITY_WEIGHT: Record<string, number> = {
  starter: 0,
  common: 3,
  uncommon: 2,
  rare: 1,
  special: 0,
};

function takeWeighted<T>(rng: RngStream, items: readonly T[], weightOf: (item: T) => number, count: number): T[] {
  const remaining = [...items];
  const taken: T[] = [];
  while (taken.length < count && remaining.length > 0) {
    const total = remaining.reduce((sum, item) => sum + Math.max(0, weightOf(item)), 0);
    if (total <= 0) {
      const index = rng.nextInt(0, remaining.length - 1);
      taken.push(remaining[index]);
      remaining.splice(index, 1);
      continue;
    }
    let roll = rng.nextInt(1, total);
    let picked = remaining[remaining.length - 1];
    for (const item of remaining) {
      roll -= Math.max(0, weightOf(item));
      if (roll <= 0) {
        picked = item;
        break;
      }
    }
    taken.push(picked);
    remaining.splice(remaining.indexOf(picked), 1);
  }
  return taken;
}

/** 结算一个事件选项；选项不存在返回 null。 */
export function resolveEventOption(
  content: ContentDb,
  event: EventDefinition,
  optionId: string,
  ctx: EventResolveContext,
): EventResolution | null {
  const option = event.options.find((o) => o.id === optionId);
  if (!option) return null;

  // 条件不满足直接拒绝（docs/54 E6）：store 会先拦一道，core 这里是唯一口径。
  // 老调用方不传 hp 时不做条件判定（兼容既有测试与 sim）。
  if (option.condition && ctx.hp !== undefined) {
    const ok = checkEventCondition(option.condition, {
      hp: ctx.hp,
      maxHp: ctx.maxHp ?? 0,
      pollution: ctx.pollution ?? 0,
      relicCount: ctx.ownedRelics.length,
      loseableRelicCount: loseableRelicPool(content, ctx.ownedRelics, ctx.identityRelics ?? []).length,
    });
    if (!ok) return null;
  }

  const rng = new Rng(ctx.seed >>> 0).stream("event");
  let outcomeIndex = -1;
  // 选项的固定代价先算，再叠加随机结果（E1「押 8 点 HP」= 先付筹码，再赌赢/输）
  const effects: EventEffect[] = [...(option.effects ?? [])];
  let i18n = option.i18n ?? "";
  if (option.outcomes && option.outcomes.length > 0) {
    const picked = rng.weighted(option.outcomes.map((o) => [o, o.weight] as const));
    outcomeIndex = option.outcomes.indexOf(picked);
    effects.push(...picked.effects);
    i18n = picked.i18n;
  }

  let hpDelta = 0;
  let maxHpDelta = 0;
  let pollutionDelta = 0;
  const relicIds: string[] = [];
  const loseRelicIds: string[] = [];
  const cardIds: string[] = [];
  let removeCard = false;
  let upgradeIndex = -1;
  let gainEnhancement = false;
  /** 同一选项里多次 upgradeRandom 不重复点同一张牌 */
  const upgraded = new Set<number>();

  for (const effect of effects) {
    switch (effect.kind) {
      case "hp":
        hpDelta += effect.value ?? 0;
        break;
      // E1：代价/收益随上限缩放（docs/54 军规 2）
      case "hpPercent":
        hpDelta += percentHpDelta(ctx.maxHp ?? 0, effect.value ?? 0);
        break;
      // E4：只动上限；当前 HP 的「同额」由调用方写回（applyEventHp 单点实现）
      case "maxHp":
        maxHpDelta += effect.value ?? 0;
        break;
      case "pollution":
        pollutionDelta += effect.value ?? 0;
        break;
      // E5：从「可典当池」随机抽取（docs/55 Q1：T1/T2 − 身份件）
      case "loseRelic": {
        const pool = loseableRelicPool(content, ctx.ownedRelics, ctx.identityRelics ?? []);
        loseRelicIds.push(...takeWeighted(rng, pool, () => 1, effect.count ?? 1));
        break;
      }
      // E2：开删牌渠道；具体删哪张由玩家在 UI 里选（规则在 core，选择在玩家）
      case "removeCard":
        removeCard = true;
        break;
      // E3：随机升级一张未升级牌；没有可升级的就落空（文案兜底）
      case "upgradeRandom": {
        const candidates = (ctx.deckUpgradeable ?? []).filter((i) => !upgraded.has(i));
        if (candidates.length > 0) {
          const picked = candidates[rng.nextInt(0, candidates.length - 1)]!;
          upgradeIndex = picked;
          upgraded.add(picked);
        }
        break;
      }
      case "gainRelic": {
        const unlocked = ctx.unlocked ?? [];
        const available = (id: string): boolean => {
          const cond = content.relics.get(id)?.unlockCondition;
          return !cond || cond === "none" || unlocked.includes(id);
        };
        // 事件遗物 = T1+T2 混合池（docs/38 §一 A-1）；身份件（无 tier）不入池
        const pool = [...content.relics.values()]
          .filter((r) => r.tier === 1 || r.tier === 2)
          .map((r) => r.id)
          .filter((id) => !ctx.ownedRelics.includes(id) && available(id))
          .sort();
        relicIds.push(...takeWeighted(rng, pool, () => 1, effect.count ?? 1));
        break;
      }
      case "gainCard": {
        const unlocked = ctx.unlocked ?? [];
        const byUnlock = (id: string): boolean => {
          const cond = content.cards.get(id)?.unlockCondition;
          return !cond || cond === "none" || unlocked.includes(id);
        };
        // docs/56 §四.3 显式池语义修正：按「职业可用性」过滤（本职业 + 中立）——
        // 拔掉 docs/16 那个"池子跟职业不匹配就保留原池"的补丁，它就是分组错误留下的补丁，
        // 会让血械抽到充能牌（死牌）。过滤后为空则退化为中立池。
        const weightOf = (id: string) => RARITY_WEIGHT[content.cards.get(id)?.rarity ?? "common"] ?? 0;
        if (effect.pool) {
          const explicit = (effect.pool ?? [])
            .filter((id) => content.cards.has(id))
            .filter((id) => {
              const card = content.cards.get(id)!;
              return (
                usableForClass(ctx.classId, card.class) &&
                card.token !== true &&
                byUnlock(id) &&
                (effect.rarity ? card.rarity === effect.rarity : true)
              );
            });
          const neutralFallback = [...content.cards.values()]
            .filter((c) => c.class === NEUTRAL_CLASS && c.token !== true && byUnlock(c.id))
            .map((c) => c.id)
            .sort();
          const pool = explicit.length > 0 ? explicit : neutralFallback;
          cardIds.push(...takeWeighted(rng, pool, weightOf, effect.count ?? 1));
          break;
        }
        // docs/56 §四.2：无显式池 = 与战斗奖励同口径，每张独立掷 70% 职业 / 30% 中立
        const usable = [...content.cards.values()].filter(
          (c) =>
            c.rarity !== "starter" &&
            c.type !== "curse" &&
            c.type !== "status" &&
            // 衍生物牌不进任何掉落池（甲方 2026-10-08）
            c.token !== true &&
            (effect.rarity ? c.rarity === effect.rarity : true) &&
            byUnlock(c.id),
        );
        const classIds = usable.filter((c) => c.class === ctx.classId).map((c) => c.id).sort();
        const neutralIds = usable.filter((c) => c.class === NEUTRAL_CLASS).map((c) => c.id).sort();
        const taken: string[] = [];
        for (let i = 0; i < (effect.count ?? 1); i += 1) {
          const pool = pickPoolSide(
            rng,
            classIds.filter((id) => !taken.includes(id)),
            neutralIds.filter((id) => !taken.includes(id)),
          );
          if (pool.length === 0) break;
          const picked = takeWeighted(rng, pool, effect.rarity ? () => 1 : weightOf, 1)[0];
          if (picked) taken.push(picked);
        }
        cardIds.push(...taken);
        break;
      }
      case "gainEnhancement":
        gainEnhancement = true;
        break;
      default:
        break;
    }
  }

  return {
    optionId,
    outcomeIndex,
    i18n,
    hpDelta,
    maxHpDelta,
    pollutionDelta,
    relicIds,
    loseRelicIds,
    cardIds,
    removeCard,
    upgradeIndex,
    gainEnhancement,
  };
}
