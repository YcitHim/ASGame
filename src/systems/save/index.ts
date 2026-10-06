/**
 * systems/save · 存档底座（ADR-008：version + migration 链，第一天就实现）
 *
 * 0.1 只落设置项与进度占位；卡组实例 / RNG 快照 / 回放输入流在 S5 接入。
 * 约束：本模块是 UI 侧服务，不得被 src/core 引用（G3 lint）。
 */

export const SAVE_NAMESPACE = "rustandblood";

/** 存档 schema 版本：任何字段变更都要 +1 并补一个 migration。 */
export const SCHEMA_VERSION = 6;

export type SaveSlot = "settings" | "progress" | "replay" | "codex" | "meta";

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
  // 1 → 2（docs/16 P3.4）：远征进度档新增 recastUsedNode（重铸每祭坛限 1 次）。
  // 只对"进度档"补字段——settings / replay 等其它槽位共享同一版本链，不能被污染。
  1: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    if (!("run" in record) && !("deck" in record)) return record;
    return { ...record, recastUsedNode: record["recastUsedNode"] ?? null };
  },
  // 2 → 3：进度档新增 enhanceUsedNode —— 「每个节点只允许附着 1 枚强化」改由 store 判定，
  // 修复「从地图重复进入祭坛可反复附着」的 bug（玩家报）。
  2: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    if (!("run" in record) && !("deck" in record)) return record;
    return { ...record, enhanceUsedNode: record["enhanceUsedNode"] ?? null };
  },
  // 3 → 4（docs/27 §三）：局外进度新增污染 RunState.pollution（事件可增减、跨节点保留）。
  3: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    const run = record["run"];
    if (typeof run !== "object" || run === null) return record;
    const runRecord = run as Record<string, unknown>;
    return { ...record, run: { ...runRecord, pollution: runRecord["pollution"] ?? 0 } };
  },
  // 4 → 5（docs/16 5.4）：进度档的线性 nodeIndex 升级为「层 + 分支」layerIndex + picked。
  // 旧档按 nodeIndex 近似落在同一层，picked 置空（到分支层时玩家重新选路）。
  4: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    const run = record["run"];
    if (typeof run !== "object" || run === null) return record;
    const runRecord = run as Record<string, unknown>;
    if (runRecord["layerIndex"] !== undefined) return record;
    return {
      ...record,
      run: {
        ...runRecord,
        layerIndex: typeof runRecord["nodeIndex"] === "number" ? runRecord["nodeIndex"] : 0,
        picked: runRecord["picked"] ?? [],
      },
    };
  },
  // 5 → 6（docs/36 T1/T2）：RunState 新增局外解锁快照 unlocked、难度 difficulty、
  // 成就计数 usedBloodpact / overloadCount。meta 槽同样过链，只碰带 run 的进度档。
  5: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    const run = record["run"];
    if (typeof run !== "object" || run === null) return record;
    const runRecord = run as Record<string, unknown>;
    return {
      ...record,
      run: {
        ...runRecord,
        unlocked: runRecord["unlocked"] ?? [],
        difficulty: runRecord["difficulty"] ?? "normal",
        usedBloodpact: runRecord["usedBloodpact"] ?? false,
        overloadCount: runRecord["overloadCount"] ?? 0,
      },
    };
  },
};

function isEnvelope(raw: unknown): raw is Envelope {
  return typeof raw === "object" && raw !== null && "version" in raw && "data" in raw;
}

/**
 * 把任意历史形态的存档升到当前版本；不认识的结构直接丢弃。
 * 兼容"无信封"裸存档（0.1 时代可能的残留）：按 v0 处理，**不丢弃**（docs/23 §2）。
 */
export function migrate(raw: unknown): { version: number; data: unknown } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const envelope: Envelope = isEnvelope(raw) ? raw : { version: 0, savedAt: 0, data: raw };
  let version = typeof envelope.version === "number" ? envelope.version : 0;
  let data = envelope.data;
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
