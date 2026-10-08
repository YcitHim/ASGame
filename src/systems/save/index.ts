/**
 * systems/save · 存档底座（ADR-008：version + migration 链，第一天就实现）
 *
 * 0.1 只落设置项与进度占位；卡组实例 / RNG 快照 / 回放输入流在 S5 接入。
 * 约束：本模块是 UI 侧服务，不得被 src/core 引用（G3 lint）。
 */

export const SAVE_NAMESPACE = "rustandblood";

/** 存档 schema 版本：任何字段变更都要 +1 并补一个 migration。 */
export const SCHEMA_VERSION = 17;

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
  // 6 → 7（docs/38 §一 A-3）：随身遗物 pickedRelic 进 RunState。
  // 旧档没有这次自选，按「身份件原配的第二件」补回（血械 blood_pump / 炉心 pressuregauge），
  // 保证旧档强度不突变；职业 JSON 的 startRelics 已收敛为单件身份件。
  6: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    const run = record["run"];
    if (typeof run !== "object" || run === null) return record;
    const runRecord = run as Record<string, unknown>;
    if (runRecord["pickedRelic"] !== undefined) return record;
    const fallback =
      runRecord["classId"] === "engineer"
        ? "pressuregauge"
        : runRecord["classId"] === "bloodwright"
          ? "blood_pump"
          : "";
    return { ...record, run: { ...runRecord, pickedRelic: fallback } };
  },
  // 7 → 8（docs/38 §三 C-3）：RunState 新增成就/纪录统计
  // interrupts / backlashTaken / turns / pollutionPeak（pollutionPeak 旧档以当前 pollution 兜底）。
  7: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    const run = record["run"];
    if (typeof run !== "object" || run === null) return record;
    const runRecord = run as Record<string, unknown>;
    if (runRecord["interrupts"] !== undefined) return record;
    return {
      ...record,
      run: {
        ...runRecord,
        interrupts: runRecord["interrupts"] ?? 0,
        backlashTaken: runRecord["backlashTaken"] ?? 0,
        turns: runRecord["turns"] ?? 0,
        pollutionPeak: runRecord["pollutionPeak"] ?? runRecord["pollution"] ?? 0,
      },
    };
  },
  // 8 → 9（docs/40 §2.1）：转地图新增 actIndex / deepestAct / deepestLayer / legacy。
  // 旧档没有第二幕上下文：进行中的续 act1；已通关一幕（layerIndex ≥ 8）的标为 legacy，
  // 不再提供「继续远征」入口（强行续幕会破坏 replay 一致性）。
  8: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    const run = record["run"];
    if (typeof run !== "object" || run === null) return record;
    const runRecord = run as Record<string, unknown>;
    if (runRecord["actIndex"] !== undefined) return record;
    const layerIndex = typeof runRecord["layerIndex"] === "number" ? runRecord["layerIndex"] : 0;
    return {
      ...record,
      run: {
        ...runRecord,
        actIndex: 0,
        deepestAct: 1,
        deepestLayer: layerIndex,
        legacy: layerIndex >= 8,
      },
    };
  },
  // 9 → 10（docs/41 §4.1 / §4.3）：meta 槽新增 tips（首遇提示已读）与教学状态。
  // 只碰 meta 槽（带 achievements / clearedClasses 的那个），不污染进度档。
  // 旧档视为"没被问过、没做过教学"（tutorialOffered 默认 false 会再问一次，符合预期）。
  9: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    if (!("achievements" in record) && !("clearedClasses" in record)) return record;
    return {
      ...record,
      tips: record["tips"] ?? [],
      tutorialOffered: record["tutorialOffered"] ?? false,
      tutorialDone: record["tutorialDone"] ?? false,
    };
  },
  // 10 → 11（docs/42 §三.0）：教学改为**按职业**记录（换职业只补教机制课）。
  // 旧档的布尔值无法回推是哪个职业，按策划裁定重置为"没被问过"——代价是再被问一次，可接受。
  10: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    if (!("achievements" in record) && !("clearedClasses" in record)) return record;
    return { ...record, tutorialOffered: [], tutorialDone: [] };
  },
  // 11 → 12（docs/43 Q2）：meta 槽新增 tutorial（未完成的「第一班岗」断点）。
  // 旧档没有"进行中的教学"这个概念 → null；不重问（tutorialOffered 已在 v10→11 落好）。
  11: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    if (!("achievements" in record) && !("clearedClasses" in record)) return record;
    return { ...record, tutorial: record["tutorial"] ?? null };
  },
  // 12 → 13（docs/48 §六）：地图从「每层抽签」改成 DAG，旧线性进度档无法无损映射。
  // 裁决：**作废进行中的旧 run**（回标题页，progress 档置 null）；
  // meta（图鉴/成就/解锁/教学）与 settings / codex / replay 原样通过。
  12: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    if (!("run" in record) && !("deck" in record)) return record;
    return null;
  },
  // 13 → 14（docs/54 E7）：RunState 新增 seenEvents（本幕已抽过的事件，不放回池）。
  // 旧档没有这份记录 → 空数组（这一幕可能再撞一次已见过的事件，下一幕起正常）。
  13: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    const run = record["run"];
    if (typeof run !== "object" || run === null) return record;
    const runRecord = run as Record<string, unknown>;
    return { ...record, run: { ...runRecord, seenEvents: runRecord["seenEvents"] ?? [] } };
  },
  // 14 → 15（docs/58 §八.1）：RunState 新增 traitId（职业特性，开局三选）。
  // 旧档没有这次选择 → 空串 = 无特性开局（纯现版玩法，强度不突变）。
  14: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    const run = record["run"];
    if (typeof run !== "object" || run === null) return record;
    const runRecord = run as Record<string, unknown>;
    return { ...record, run: { ...runRecord, traitId: runRecord["traitId"] ?? "" } };
  },
  // 15 → 16（甲方 2026-10-08）：RunState 新增 startedAt（通关用时的起算点）。
  // 旧档没有开局时间戳 → 0 = 不计时（用时显示「—」，不编一个假的）。
  15: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    const run = record["run"];
    if (typeof run !== "object" || run === null) return record;
    const runRecord = run as Record<string, unknown>;
    return { ...record, run: { ...runRecord, startedAt: runRecord["startedAt"] ?? 0 } };
  },
  // 16 → 17（甲方 2026-10-08「完成时间改为日期」+「每职业×特性分别记」）：
  //  - RunRecord.millis（完成用时 ms）作废，改为 date（ISO YYYY-MM-DD）——摘掉旧 millis 键；
  //  - 纪录键升级为三段式 `职业:难度:特性`——此处只做**形状**迁移（每项补 date: null 且删 millis），
  //    键名的三段式归一化放在 stores/meta 的 ensureLoaded 里（对无信封 / 老格式更稳）。
  //  - 只碰 meta 槽（带 records / achievements 的那个），进度档 / 设置 / 图鉴原样通过。
  16: (data) => {
    if (typeof data !== "object" || data === null) return data;
    const record = data as Record<string, unknown>;
    const records = record["records"];
    if (typeof records !== "object" || records === null) return record;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(records as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) {
        next[key] = value;
        continue;
      }
      const rec = value as Record<string, unknown>;
      const { millis: _drop, ...rest } = rec;
      next[key] = { ...rest, date: rest["date"] ?? null };
    }
    return { ...record, records: next };
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
