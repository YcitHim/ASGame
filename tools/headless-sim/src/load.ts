/**
 * headless-sim · Node 侧内容装载（不走 Vite，直接读 data/*.json）
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEnemyDefinition,
  createContentDb,
  type ActDefinition,
  type CardDefinition,
  type ClassDefinition,
  type ContentDb,
  type EnemyDefinition,
  type EnhancementDefinition,
  type EventDefinition,
  type RawEnemyDefinition,
  type RelicDefinition,
  type TraitDefinition,
} from "../../../src/core/registry";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../../..");
const DATA_ROOT = join(REPO_ROOT, "src", "data");

function walkJson(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(walkJson(full));
    else if (name.endsWith(".json")) out.push(full);
  }
  return out;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

type EnemyJson = RawEnemyDefinition & { i18n: string };

export interface NodeGameContent {
  content: ContentDb;
  acts: ActDefinition[];
  i18n: Record<string, string>;
}

export function loadNodeContent(): NodeGameContent {
  const i18n = readJson<Record<string, string>>(join(DATA_ROOT, "i18n", "zh-CN.json"));

  const cards = new Map<string, CardDefinition>();
  for (const f of walkJson(join(DATA_ROOT, "cards"))) {
    const c = readJson<CardDefinition>(f);
    cards.set(c.id, c);
  }
  const enhancements = new Map<string, EnhancementDefinition>();
  for (const f of walkJson(join(DATA_ROOT, "enhancements"))) {
    const e = readJson<EnhancementDefinition>(f);
    enhancements.set(e.id, e);
  }
  const relics = new Map<string, RelicDefinition>();
  for (const f of walkJson(join(DATA_ROOT, "relics"))) {
    const r = readJson<RelicDefinition>(f);
    relics.set(r.id, r);
  }
  const events = new Map<string, EventDefinition>();
  for (const f of walkJson(join(DATA_ROOT, "events"))) {
    const e = readJson<EventDefinition>(f);
    events.set(e.id, e);
  }
  const classes = new Map<string, ClassDefinition>();
  for (const f of walkJson(join(DATA_ROOT, "classes"))) {
    const c = readJson<ClassDefinition>(f);
    classes.set(c.id, c);
  }
  const traits = new Map<string, TraitDefinition>();
  for (const f of walkJson(join(DATA_ROOT, "traits"))) {
    const t = readJson<TraitDefinition>(f);
    traits.set(t.id, t);
  }
  const enemies = new Map<string, EnemyDefinition>();
  for (const f of walkJson(join(DATA_ROOT, "enemies"))) {
    const e = readJson<EnemyJson>(f);
    enemies.set(e.id, buildEnemyDefinition(e, i18n[`enemy.${e.id}.name`] ?? e.id));
  }
  const acts = walkJson(join(DATA_ROOT, "acts"))
    .map((f) => readJson<ActDefinition>(f))
    .sort((a, b) => a.id.localeCompare(b.id));

  return { content: createContentDb({ cards, enemies, enhancements, relics, events, classes, traits }), acts, i18n };
}
