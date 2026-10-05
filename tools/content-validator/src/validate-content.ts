import type { ZodType } from "zod";
import {
  actSchema,
  cardSchema,
  enemySchema,
  enhancementSchema,
  relicSchema,
  type ActJson,
  type CardJson,
  type EnemyJson,
  type EnhancementJson,
  type RelicJson,
} from "./schema";

export interface SourceFile {
  /** 相对仓库根的展示路径，报错定位用 */
  file: string;
  data: unknown;
}

export interface ValidationIssue {
  file: string;
  path: string;
  message: string;
}

export interface ContentInput {
  cards: SourceFile[];
  enhancements: SourceFile[];
  enemies?: SourceFile[];
  acts?: SourceFile[];
  relics?: SourceFile[];
  i18n: Record<string, string>;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  cards: CardJson[];
  enhancements: EnhancementJson[];
  enemies: EnemyJson[];
  acts: ActJson[];
  relics: RelicJson[];
}

function zodIssues(file: string, error: unknown): ValidationIssue[] {
  const err = error as { issues?: { path: (string | number | symbol)[]; message: string }[] };
  const issues = err.issues ?? [];
  return issues.map((i) => ({
    file,
    path: i.path.length ? i.path.map(String).join(".") : "(root)",
    message: i.message,
  }));
}

function parseAll<T>(schema: ZodType<T>, files: SourceFile[], out: T[], issues: ValidationIssue[]): void {
  for (const f of files) {
    const result = schema.safeParse(f.data);
    if (result.success) out.push(result.data);
    else issues.push(...zodIssues(f.file, result.error));
  }
}

/** 纯函数：不碰文件系统，便于单测与 CI 复用。 */
export function validateContent(input: ContentInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  const cards: CardJson[] = [];
  const enhancements: EnhancementJson[] = [];
  const enemies: EnemyJson[] = [];
  const acts: ActJson[] = [];
  const relics: RelicJson[] = [];

  parseAll(cardSchema, input.cards, cards, issues);
  parseAll(enhancementSchema, input.enhancements, enhancements, issues);
  parseAll(enemySchema, input.enemies ?? [], enemies, issues);
  parseAll(actSchema, input.acts ?? [], acts, issues);
  parseAll(relicSchema, input.relics ?? [], relics, issues);

  // 全局 id 唯一（docs/04 §4）
  const seen = new Map<string, string>();
  const checkId = (kind: string, id: string): void => {
    const prev = seen.get(id);
    if (prev) issues.push({ file: kind + " " + id, path: "id", message: `id "${id}" 与 ${prev} 重复` });
    else seen.set(id, kind + " " + id);
  };
  for (const c of cards) checkId("card", c.id);
  for (const e of enhancements) checkId("enhancement", e.id);
  for (const e of enemies) checkId("enemy", e.id);
  for (const a of acts) checkId("act", a.id);
  for (const r of relics) checkId("relic", r.id);

  // 强化 appliesTo / mutex 引用
  const cardIds = new Set(cards.map((c) => c.id));
  const enhIds = new Set(enhancements.map((e) => e.id));
  for (const e of enhancements) {
    for (const target of e.appliesTo) {
      if (!cardIds.has(target)) {
        issues.push({ file: `enhancement ${e.id}`, path: "appliesTo", message: `引用了不存在的卡牌 "${target}"` });
      }
    }
    for (const other of e.mutex ?? []) {
      if (!enhIds.has(other)) {
        issues.push({ file: `enhancement ${e.id}`, path: "mutex", message: `互斥指向不存在的强化 "${other}"` });
      }
    }
  }

  // act 引用：起手卡组与遭遇敌人
  const enemyIds = new Set(enemies.map((e) => e.id));
  const relicIds = new Set(relics.map((r) => r.id));
  for (const act of acts) {
    for (const cardId of act.startDeck) {
      if (!cardIds.has(cardId)) {
        issues.push({ file: `act ${act.id}`, path: "startDeck", message: `引用了不存在的卡牌 "${cardId}"` });
      }
    }
    for (const node of act.map) {
      const needsEnemies = node.kind === "battle" || node.kind === "elite" || node.kind === "boss";
      if (needsEnemies && (!node.enemies || node.enemies.length === 0)) {
        issues.push({ file: `act ${act.id}`, path: `map.${node.id}`, message: `${node.kind} 节点必须配置 enemies` });
      }
      for (const enemyId of node.enemies ?? []) {
        if (!enemyIds.has(enemyId)) {
          issues.push({ file: `act ${act.id}`, path: `map.${node.id}`, message: `引用了不存在的敌人 "${enemyId}"` });
        }
      }
    }
    for (const relicId of act.startRelics ?? []) {
      if (!relicIds.has(relicId)) {
        issues.push({ file: `act ${act.id}`, path: "startRelics", message: `引用了不存在的遗物 "${relicId}"` });
      }
    }
    if (!(act.i18n in input.i18n)) {
      issues.push({ file: `act ${act.id}`, path: "i18n", message: `文案缺失：zh-CN 无 "${act.i18n}"` });
    }
  }

  // i18n key 存在（docs/04 §4）
  const requireKey = (file: string, key: string): void => {
    if (!(key in input.i18n)) issues.push({ file, path: "i18n", message: `文案缺失：zh-CN 无 "${key}"` });
  };
  for (const c of cards) {
    const base = c.i18n ?? `card.${c.id}`;
    requireKey(`card ${c.id}`, base + ".name");
    requireKey(`card ${c.id}`, base + ".desc");
  }
  for (const e of enhancements) {
    const base = e.i18n ?? `enh.${e.id}`;
    requireKey(`enhancement ${e.id}`, base + ".name");
    requireKey(`enhancement ${e.id}`, base + ".desc");
  }
  for (const e of enemies) {
    requireKey(`enemy ${e.id}`, `enemy.${e.id}.name`);
  }
  for (const r of relics) {
    requireKey(`relic ${r.id}`, r.i18n + ".name");
  }

  return { issues, cards, enhancements, enemies, acts, relics };
}

/** 报错文本：带文件与字段定位（docs/05 G1 验收要求）。 */
export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => `  ✗ ${i.file} → ${i.path}: ${i.message}`).join("\n");
}