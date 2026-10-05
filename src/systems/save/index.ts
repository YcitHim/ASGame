/**
 * systems/save · 存档底座（ADR-008：version + migration 链，第一天就实现）
 *
 * 0.1 只落设置项与进度占位；卡组实例 / RNG 快照 / 回放输入流在 S5 接入。
 * 约束：本模块是 UI 侧服务，不得被 src/core 引用（G3 lint）。
 */

export const SAVE_NAMESPACE = "rustandblood";

/** 存档 schema 版本：任何字段变更都要 +1 并补一个 migration。 */
export const SCHEMA_VERSION = 1;

export type SaveSlot = "settings" | "progress" | "replay";

export function slotKey(slot: SaveSlot): string {
  return `${SAVE_NAMESPACE}:${slot}`;
}

interface Envelope {
  version: number;
  savedAt: number;
  data: unknown;
}

/**
 * migration 链：键为"起始版本"，值把 data 从该版本升到 +1。
 * 例：1: (d) => ({ ...d, newField: 0 })
 */
const migrations: Record<number, (data: unknown) => unknown> = {
  // 0 → 1：初版，无历史数据，仅补齐结构
  0: (data) => data,
};

function isEnvelope(raw: unknown): raw is Envelope {
  return typeof raw === "object" && raw !== null && "version" in raw && "data" in raw;
}

/** 把任意历史形态的存档升到当前版本；不认识的结构直接丢弃。 */
export function migrate(raw: unknown): { version: number; data: unknown } | null {
  if (!isEnvelope(raw)) return null;
  let version = typeof raw.version === "number" ? raw.version : 0;
  let data = raw.data;
  if (version > SCHEMA_VERSION) return null; // 来自未来的存档，不猜
  while (version < SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) return null;
    data = step(data);
    version += 1;
  }
  return { version, data };
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // 隐私模式 / 无 localStorage 环境
  }
}

/** 读取存档槽；缺失或损坏返回 fallback。 */
export function readSlot<T>(slot: SaveSlot, fallback: T): T {
  const store = storage();
  if (!store) return fallback;
  const raw = store.getItem(slotKey(slot));
  if (!raw) return fallback;
  try {
    const migrated = migrate(JSON.parse(raw));
    if (!migrated) return fallback;
    return migrated.data as T;
  } catch {
    return fallback;
  }
}

/** 写入存档槽（带版本信封）。 */
export function writeSlot(slot: SaveSlot, data: unknown): void {
  const store = storage();
  if (!store) return;
  const envelope: Envelope = { version: SCHEMA_VERSION, savedAt: Date.now(), data };
  try {
    store.setItem(slotKey(slot), JSON.stringify(envelope));
  } catch {
    /* 配额溢出等：静默失败，不阻断游戏 */
  }
}

export function clearSlot(slot: SaveSlot): void {
  storage()?.removeItem(slotKey(slot));
}

export function hasSlot(slot: SaveSlot): boolean {
  return storage()?.getItem(slotKey(slot)) != null;
}
