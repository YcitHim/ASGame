import { beforeEach, describe, expect, it } from "vitest";

/** Node 环境无 localStorage，注入最小内存实现。 */
function installLocalStorage(): void {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

const { clearSlot, hasSlot, migrate, readSlot, slotKey, writeSlot, SCHEMA_VERSION } = await import(
  "@/systems/save"
);

describe("systems/save（ADR-008）", () => {
  beforeEach(() => installLocalStorage());

  it("写入后能读回，且键带命名空间", () => {
    writeSlot("settings", { masterVolume: 0.5 });
    expect(readSlot("settings", null)).toEqual({ masterVolume: 0.5 });
    expect(slotKey("settings")).toBe("rustandblood:settings");
    expect(hasSlot("settings")).toBe(true);
    clearSlot("settings");
    expect(hasSlot("settings")).toBe(false);
  });

  it("缺失槽位返回 fallback", () => {
    expect(readSlot("progress", { node: 0 })).toEqual({ node: 0 });
  });

  it("损坏 JSON 不抛异常，返回 fallback", () => {
    localStorage.setItem(slotKey("progress"), "{not json");
    expect(readSlot("progress", "fallback")).toBe("fallback");
  });

  it("migration 链把 v0 假存档升到当前版本", () => {
    localStorage.setItem(slotKey("progress"), JSON.stringify({ version: 0, data: { node: 2 } }));
    const result = migrate(JSON.parse(localStorage.getItem(slotKey("progress")) as string));
    expect(result?.version).toBe(SCHEMA_VERSION);
    expect(result?.data).toEqual({ node: 2 });
    expect(readSlot("progress", null)).toEqual({ node: 2 });
  });

  it("无信封裸存档按 v0 迁移，不丢弃（docs/23 §2）", () => {
    const raw = { run: { nodeIndex: 3 }, deck: [], relics: [], acquired: [] };
    localStorage.setItem(slotKey("progress"), JSON.stringify(raw));
    expect(readSlot("progress", null)).toMatchObject({ run: { nodeIndex: 3 }, recastUsedNode: null });
  });

  it("v1 进度档迁移到 v2 时补 recastUsedNode；非进度档不被污染", () => {
    const progress = migrate({ version: 1, data: { run: { nodeIndex: 1 }, deck: [] } });
    expect(progress?.version).toBe(SCHEMA_VERSION);
    expect((progress?.data as { recastUsedNode?: unknown }).recastUsedNode).toBeNull();
    expect((progress?.data as { enhanceUsedNode?: unknown }).enhanceUsedNode).toBeNull();

    const settings = migrate({ version: 1, data: { masterVolume: 0.5 } });
    expect(settings?.data).toEqual({ masterVolume: 0.5 });
  });

  it("v5 进度档迁移到 v6 时补 unlocked / difficulty / 成就计数；非进度档不被污染", () => {
    const progress = migrate({ version: 5, data: { run: { layerIndex: 2, picked: [] }, deck: [] } });
    expect(progress?.version).toBe(SCHEMA_VERSION);
    expect(progress?.data).toMatchObject({
      run: { layerIndex: 2, unlocked: [], difficulty: "normal", usedBloodpact: false, overloadCount: 0 },
    });
    const meta = migrate({ version: 5, data: { clearedClasses: ["bloodwright"], unlocked: [] } });
    // 一路迁到 v12：meta 槽补 tips、按职业的教学字段与教学断点（docs/41/42/43）
    expect(meta?.data).toEqual({
      clearedClasses: ["bloodwright"],
      unlocked: [],
      tips: [],
      tutorialOffered: [],
      tutorialDone: [],
      tutorial: null,
    });
  });

  it("v7 进度档迁移到 v8 时补成就统计字段；非进度档不被污染", () => {
    const progress = migrate({ version: 7, data: { run: { layerIndex: 1, picked: [], pollution: 30 }, deck: [] } });
    expect(progress?.version).toBe(SCHEMA_VERSION);
    expect(progress?.data).toMatchObject({
      run: { interrupts: 0, backlashTaken: 0, turns: 0, pollutionPeak: 30 },
    });
    const codex = migrate({ version: 7, data: { cards: [], relics: [], enemies: [] } });
    expect(codex?.data).toEqual({ cards: [], relics: [], enemies: [] });
  });

  it("v8 进度档迁移到 v9：补转地图字段；一幕已通关的档标 legacy", () => {
    const mid = migrate({ version: 8, data: { run: { classId: "bloodwright", layerIndex: 3 }, deck: [] } });
    expect(mid?.version).toBe(SCHEMA_VERSION);
    expect(mid?.data).toMatchObject({ run: { actIndex: 0, deepestAct: 1, deepestLayer: 3, legacy: false } });
    const done = migrate({ version: 8, data: { run: { classId: "bloodwright", layerIndex: 8 }, deck: [] } });
    expect((done?.data as { run: { legacy?: boolean } }).run.legacy).toBe(true);
  });

  it("来自未来版本的存档不猜，直接丢弃", () => {
    localStorage.setItem(slotKey("progress"), JSON.stringify({ version: SCHEMA_VERSION + 5, data: {} }));
    expect(readSlot("progress", "fallback")).toBe("fallback");
  });
});

describe("存档迁移 9 → 11（docs/41 §4.1 / docs/42 §三.0）", () => {
  it("meta 槽补 tips 与按职业的教学字段；进度档不被污染", async () => {
    const { migrate, SCHEMA_VERSION } = await import("@/systems/save");
    expect(SCHEMA_VERSION).toBe(12);

    const meta = migrate({ version: 9, savedAt: 0, data: { clearedClasses: ["bloodwright"], achievements: [] } });
    const metaData = meta?.data as { tips: string[]; tutorialOffered: string[]; tutorialDone: string[] };
    expect(metaData.tips).toEqual([]);
    // 9→10 先给布尔，10→11 再改成按职业的数组（旧档无法回推职业 → 重置为"没被问过"）
    expect(metaData.tutorialOffered).toEqual([]);
    expect(metaData.tutorialDone).toEqual([]);

    const progress = migrate({ version: 9, savedAt: 0, data: { run: { actIndex: 1 } } });
    expect((progress?.data as Record<string, unknown>).tips).toBeUndefined();

    // 已有 tips 的存档不被覆盖
    const kept = migrate({ version: 9, savedAt: 0, data: { clearedClasses: [], tips: ["discard"] } });
    expect((kept?.data as { tips: string[] }).tips).toEqual(["discard"]);
  });

  it("10 → 11：布尔教学字段改成按职业数组", async () => {
    const { migrate } = await import("@/systems/save");
    const meta = migrate({
      version: 10,
      savedAt: 0,
      data: { clearedClasses: ["bloodwright"], tips: ["discard"], tutorialOffered: true, tutorialDone: true },
    });
    const data = meta?.data as { tips: string[]; tutorialOffered: string[]; tutorialDone: string[] };
    expect(data.tips).toEqual(["discard"]);
    expect(data.tutorialOffered).toEqual([]);
    expect(data.tutorialDone).toEqual([]);
  });

  it("11 → 12：meta 槽补 tutorial 断点，旧档视为没有进行中的教学", async () => {
    const { migrate } = await import("@/systems/save");
    const meta = migrate({
      version: 11,
      savedAt: 0,
      data: { clearedClasses: ["bloodwright"], tutorialOffered: ["bloodwright"], tutorialDone: [] },
    });
    const data = meta?.data as { tutorial: unknown; tutorialOffered: string[] };
    expect(data.tutorial).toBeNull();
    expect(data.tutorialOffered).toEqual(["bloodwright"]);

    // 进度档不被污染（教学断点只住在 meta 槽）
    const progress = migrate({ version: 11, savedAt: 0, data: { run: { actIndex: 0 } } });
    expect((progress?.data as Record<string, unknown>).tutorial).toBeUndefined();

    // 已经带着断点的存档不被覆盖
    const kept = migrate({ version: 11, savedAt: 0, data: { achievements: [], tutorial: { classId: "engineer" } } });
    expect((kept?.data as { tutorial: { classId: string } }).tutorial).toEqual({ classId: "engineer" });
  });
});

describe("settings 归一化", () => {
  it("越界音量被夹紧、非法字段回落默认", async () => {
    const { normalizeSettings, DEFAULT_SETTINGS } = await import("@/stores/settings");
    const s = normalizeSettings({ masterVolume: 5, bgmVolume: -3, battleAnim: "yes" as never });
    expect(s.masterVolume).toBe(1);
    expect(s.bgmVolume).toBe(0);
    expect(s.battleAnim).toBe(DEFAULT_SETTINGS.battleAnim);
    expect(s.animationSpeed).toBe(1);
    expect(s.language).toBe("zh-CN");
    // 甲方反馈：弹窗教学要能在设置里关
    expect(s.tipPopups).toBe(true);
    expect(normalizeSettings({ tipPopups: false }).tipPopups).toBe(false);
  });

  it("战斗动画三档合法值保留；旧档 screenShake=false 迁移为关闭（docs/41 §3.1）", async () => {
    const { normalizeSettings } = await import("@/stores/settings");
    expect(normalizeSettings({ battleAnim: "simple" }).battleAnim).toBe("simple");
    expect(normalizeSettings({ battleAnim: "off" }).battleAnim).toBe("off");
    // 旧存档：没有 battleAnim，只有 screenShake=false
    const legacy = normalizeSettings({ screenShake: false } as never);
    expect(legacy.battleAnim).toBe("off");
    expect(normalizeSettings({ screenShake: true } as never).battleAnim).toBe("full");
  });
});
