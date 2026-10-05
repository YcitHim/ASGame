import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContentInput, SourceFile } from "./validate-content";

const HERE = dirname(fileURLToPath(import.meta.url));
/** tools/content-validator/src → 仓库根 */
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

function loadJsonFiles(dir: string): SourceFile[] {
  return walkJson(dir)
    .sort()
    .map((full) => ({
      file: relative(REPO_ROOT, full).replace(/\\/g, "/"),
      data: JSON.parse(readFileSync(full, "utf8")) as unknown,
    }));
}

export function loadContent(): ContentInput {
  const i18nPath = join(DATA_ROOT, "i18n", "zh-CN.json");
  let i18n: Record<string, string>;
  try {
    i18n = JSON.parse(readFileSync(i18nPath, "utf8")) as Record<string, string>;
  } catch {
    i18n = {};
  }
  return {
    cards: loadJsonFiles(join(DATA_ROOT, "cards")),
    enhancements: loadJsonFiles(join(DATA_ROOT, "enhancements")),
    enemies: loadJsonFiles(join(DATA_ROOT, "enemies")),
    acts: loadJsonFiles(join(DATA_ROOT, "acts")),
    relics: loadJsonFiles(join(DATA_ROOT, "relics")),
    events: loadJsonFiles(join(DATA_ROOT, "events")),
    i18n,
  };
}