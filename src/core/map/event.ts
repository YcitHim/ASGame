/**
 * core/map/event · 随机事件结算（docs/27 §三 / docs/16 4.4）
 *
 * 纯函数：给定 事件定义 + 选项 + 种子，产出「发生了什么」。
 * 局外状态（HP / 污染 / 卡组 / 遗物）由调用方（run store）按返回值写回；
 * 事件 RNG 走独立的 event 流，同种子同结果（ADR-006）。
 */
import type { ContentDb, EventDefinition, EventEffect } from "../registry/content";
import { Rng, type RngStream } from "../rng";

export interface EventResolution {
  readonly optionId: string;
  /** 命中的随机结果下标；固定结果时为 -1 */
  readonly outcomeIndex: number;
  /** 结果文案 i18n key */
  readonly i18n: string;
  readonly hpDelta: number;
  readonly pollutionDelta: number;
  readonly relicIds: readonly string[];
  readonly cardIds: readonly string[];
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
  let pollutionDelta = 0;
  const relicIds: string[] = [];
  const cardIds: string[] = [];
  let gainEnhancement = false;

  for (const effect of effects) {
    switch (effect.kind) {
      case "hp":
        hpDelta += effect.value ?? 0;
        break;
      case "pollution":
        pollutionDelta += effect.value ?? 0;
        break;
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
        // 职业池隔离（docs/16 5.2）：显式池若含本职业卡则只在本职业内抽；
        // 若显式池与职业完全不匹配（如充能主题事件池）则保留原池，避免事件变空。
        const unlocked = ctx.unlocked ?? [];
        const byUnlock = (id: string): boolean => {
          const cond = content.cards.get(id)?.unlockCondition;
          return !cond || cond === "none" || unlocked.includes(id);
        };
        const byClass = (id: string): boolean => (!ctx.classId || content.cards.get(id)?.class === ctx.classId) && byUnlock(id);
        const explicit = (effect.pool ?? []).filter((id) => content.cards.has(id));
        const explicitFiltered = explicit.some(byClass) ? explicit.filter(byClass) : explicit;
        const pool = effect.pool
          ? explicitFiltered
          : [...content.cards.values()]
              .filter((c) => c.rarity !== "starter" && c.type !== "curse" && c.type !== "status")
              .filter((c) => (effect.rarity ? c.rarity === effect.rarity : true))
              .filter((c) => byClass(c.id))
              .map((c) => c.id)
              .sort();
        const weightOf = effect.pool
          ? (id: string) => RARITY_WEIGHT[content.cards.get(id)?.rarity ?? "common"] ?? 0
          : (id: string) => (effect.rarity ? 1 : RARITY_WEIGHT[content.cards.get(id)?.rarity ?? "common"] ?? 0);
        cardIds.push(...takeWeighted(rng, pool, weightOf, effect.count ?? 1));
        break;
      }
      case "gainEnhancement":
        gainEnhancement = true;
        break;
      default:
        break;
    }
  }

  return { optionId, outcomeIndex, i18n, hpDelta, pollutionDelta, relicIds, cardIds, gainEnhancement };
}
