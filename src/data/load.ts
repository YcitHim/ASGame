/**
 * data/load · 在应用启动时把 data/*.json 装入 core 的 ContentDb。
 *
 * 开发期用 Vite 的 import.meta.glob（eager）——改 JSON 即热更（G5 的挂载点）。
 * 文案不写死在 JSON 里：卡牌/遗物用 i18n key，敌人名在这里用 zh-CN 表解析。
 */
import {
  createContentDb,
  type ActDefinition,
  type CardDefinition,
  type ContentDb,
  type EnemyDefinition,
  type EnhancementDefinition,
  type RelicDefinition,
} from "@/core/registry";
import zhCN from "./i18n/zh-CN.json";

interface EnemyJson {
  id: string;
  i18n: string;
  maxHp: number;
  intents: EnemyDefinition["intents"];
}

const cardModules = import.meta.glob<{ default: CardDefinition }>("./cards/**/*.json", { eager: true });
const enhancementModules = import.meta.glob<{ default: EnhancementDefinition }>("./enhancements/**/*.json", { eager: true });
const enemyModules = import.meta.glob<{ default: EnemyJson }>("./enemies/*.json", { eager: true });
const relicModules = import.meta.glob<{ default: RelicDefinition }>("./relics/*.json", { eager: true });
const actModules = import.meta.glob<{ default: ActDefinition }>("./acts/*.json", { eager: true });

export const I18N: Record<string, string> = zhCN as Record<string, string>;

export function t(key: string | undefined, fallback = ""): string {
  if (!key) return fallback;
  return I18N[key] ?? (fallback || key);
}

export interface GameContent {
  readonly content: ContentDb;
  readonly acts: readonly ActDefinition[];
  readonly i18n: Record<string, string>;
}

let cached: GameContent | null = null;

export function loadGameContent(): GameContent {
  if (cached) return cached;

  const cards = new Map<string, CardDefinition>();
  for (const mod of Object.values(cardModules)) cards.set(mod.default.id, mod.default);

  const enhancements = new Map<string, EnhancementDefinition>();
  for (const mod of Object.values(enhancementModules)) enhancements.set(mod.default.id, mod.default);

  const relics = new Map<string, RelicDefinition>();
  for (const mod of Object.values(relicModules)) relics.set(mod.default.id, mod.default);

  const enemies = new Map<string, EnemyDefinition>();
  for (const mod of Object.values(enemyModules)) {
    const raw = mod.default;
    enemies.set(raw.id, {
      id: raw.id,
      name: I18N[`enemy.${raw.id}.name`] ?? raw.id,
      maxHp: raw.maxHp,
      intents: raw.intents,
    });
  }

  const acts = Object.values(actModules)
    .map((m) => m.default)
    .sort((a, b) => a.id.localeCompare(b.id));

  cached = {
    content: createContentDb({ cards, enemies, enhancements, relics }),
    acts,
    i18n: I18N,
  };
  return cached;
}

export function cardName(cardId: string): string {
  return t(`card.${cardId}.name`, cardId);
}

export function cardDesc(cardId: string): string {
  return t(`card.${cardId}.desc`, "");
}

export function relicName(relicId: string): string {
  return t(`relic.${relicId}.name`, relicId);
}
