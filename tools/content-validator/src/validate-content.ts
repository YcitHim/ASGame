import type { ZodType } from "zod";
import { cardSchema, enhancementSchema, type CardJson, type EnhancementJson } from "./schema";

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
  i18n: Record<string, string>;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  cards: CardJson[];
  enhancements: EnhancementJson[];
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

  parseAll(cardSchema, input.cards, cards, issues);
  parseAll(enhancementSchema, input.enhancements, enhancements, issues);

  // 全局 id 唯一（docs/04 §4）
  const seen = new Map<string, string>();
  for (const [kind, entries] of [
    ["card", cards],
    ["enhancement", enhancements],
  ] as const) {
    for (const e of entries) {
      const key = `${kind}:${e.id}`;
      const prev = seen.get(key);
      if (prev) issues.push({ file: prev, path: "id", message: `id "${e.id}" 与 ${prev} 重复` });
      else seen.set(key, kind === "card" ? `card ${e.id}` : `enhancement ${e.id}`);
    }
  }
  // 卡牌与强化不得共用同一 id
  const cardIds = new Set(cards.map((c) => c.id));
  for (const e of enhancements) {
    if (cardIds.has(e.id)) {
      issues.push({ file: `enhancement ${e.id}`, path: "id", message: `强化 id "${e.id}" 与同名卡牌冲突` });
    }
  }

  // appliesTo 引用存在
  const enhById = new Map(enhancements.map((e) => [e.id, e]));
  for (const e of enhancements) {
    for (const target of e.appliesTo) {
      if (!cardIds.has(target)) {
        issues.push({
          file: `enhancement ${e.id}`,
          path: "appliesTo",
          message: `引用了不存在的卡牌 "${target}"`,
        });
      }
    }
  }

  // mutex 对称
  for (const e of enhancements) {
    for (const other of e.mutex ?? []) {
      const o = enhById.get(other);
      if (!o) {
        issues.push({ file: `enhancement ${e.id}`, path: "mutex", message: `互斥指向不存在的强化 "${other}"` });
      } else if (!(o.mutex ?? []).includes(e.id)) {
        issues.push({
          file: `enhancement ${e.id}`,
          path: "mutex",
          message: `mutex 需互相对称："${other}" 未声明与 "${e.id}" 互斥`,
        });
      }
    }
  }

  // i18n key 存在（docs/04 §4）
  const keyOf = (raw: string | undefined, fallback: string): string => raw ?? fallback;
  for (const c of cards) {
    const base = keyOf(c.i18n, `card.${c.id}`);
    for (const suffix of [".name", ".desc"]) {
      const key = base + suffix;
      if (!(key in input.i18n)) {
        issues.push({ file: `card ${c.id}`, path: `i18n`, message: `文案缺失：zh-CN 无 "${key}"` });
      }
    }
  }
  for (const e of enhancements) {
    const base = keyOf(e.i18n, `enh.${e.id}`);
    for (const suffix of [".name", ".desc"]) {
      const key = base + suffix;
      if (!(key in input.i18n)) {
        issues.push({ file: `enhancement ${e.id}`, path: `i18n`, message: `文案缺失：zh-CN 无 "${key}"` });
      }
    }
  }

  return { issues, cards, enhancements };
}

/** 报错文本：带文件与字段定位（docs/05 G1 验收要求）。 */
export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => `  ✗ ${i.file} → ${i.path}: ${i.message}`).join("\n");
}
