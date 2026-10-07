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

  it("无信封裸存档按 v0 迁移；进度档在 12→13 作废（docs/48 §六）", () => {
    const raw = { run: { nodeIndex: 3 }, deck: [], relics: [], acquired: [] };
    localStorage.setItem(slotKey("progress"), JSON.stringify(raw));
    // 旧线性 run 无法映射进 DAG → 回标题页：不是格式损坏，是设计裁决
    expect(readSlot("progress", null)).toBeNull();
  });

  it("v1 进度档在 12→13 作废；非进度档一路升到当前版本不被污染", () => {
    const progress = migrate({ version: 1, data: { run: { nodeIndex: 1 }, deck: [] } });
    expect(progress?.version).toBe(SCHEMA_VERSION);
    expect(progress?.data).toBeNull();

    const settings = migrate({ version: 1, data: { masterVolume: 0.5 } });
    expect(settings?.data).toEqual({ masterVolume: 0.5 });
  });

  it("v5 进度档在 12→13 作废；meta 槽一路迁到当前版本（不被作废）", () => {
    const progress = migrate({ version: 5, data: { run: { layerIndex: 2, picked: [] }, deck: [] } });
    expect(progress?.version).toBe(SCHEMA_VERSION);
    expect(progress?.data).toBeNull();
    const meta = migrate({ version: 5, data: { clearedClasses: ["bloodwright"], unlocked: [] } });
    // 一路迁到 v13：meta 槽补 tips、按职业的教学字段与教学断点（docs/41/42/43）
    expect(meta?.data).toEqual({
      clearedClasses: ["bloodwright"],
      unlocked: [],
      tips: [],
      tutorialOffered: [],
      tutorialDone: [],
      tutorial: null,
    });
  });

  it("v7 进度档在 12→13 作废；codex 槽原样通过", () => {
    const progress = migrate({ version: 7, data: { run: { layerIndex: 1, picked: [], pollution: 30 }, deck: [] } });
    expect(progress?.version).toBe(SCHEMA_VERSION);
    expect(progress?.data).toBeNull();
    const codex = migrate({ version: 7, data: { cards: [], relics: [], enemies: [] } });
    expect(codex?.data).toEqual({ cards: [], relics: [], enemies: [] });
  });

  it("v8 进度档（进行中 / 已通关）都在 12→13 作废", () => {
    const mid = migrate({ version: 8, data: { run: { classId: "bloodwright", layerIndex: 3 }, deck: [] } });
    expect(mid?.version).toBe(SCHEMA_VERSION);
    expect(mid?.data).toBeNull();
    const done = migrate({ version: 8, data: { run: { classId: "bloodwright", layerIndex: 8 }, deck: [] } });
    expect(done?.data).toBeNull();
  });

  it("来自未来版本的存档不猜，直接丢弃", () => {
    localStorage.setItem(slotKey("progress"), JSON.stringify({ version: SCHEMA_VERSION + 5, data: {} }));
    expect(readSlot("progress", "fallback")).toBe("fallback");
  });
});

describe("存档迁移 9 → 11（docs/41 §4.1 / docs/42 §三.0）", () => {
  it("meta 槽补 tips 与按职业的教学字段；进度档不被污染", async () => {
    const { migrate, SCHEMA_VERSION } = await import("@/systems/save");
    expect(SCHEMA_VERSION).toBe(14);

    const meta = migrate({ version: 9, savedAt: 0, data: { clearedClasses: ["bloodwright"], achievements: [] } });
    const metaData = meta?.data as { tips: string[]; tutorialOffered: string[]; tutorialDone: string[] };
    expect(metaData.tips).toEqual([]);
    // 9→10 先给布尔，10→11 再改成按职业的数组（旧档无法回推职业 → 重置为"没被问过"）
    expect(metaData.tutorialOffered).toEqual([]);
    expect(metaData.tutorialDone).toEqual([]);

    // 进度档走到 12→13 被作废（docs/48 §六）：不是被 tips 污染，是整个 run 不留
    const progress = migrate({ version: 9, savedAt: 0, data: { run: { actIndex: 1 } } });
    expect(progress?.data).toBeNull();

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

    // 进度档走到 12→13 被作废（教学断点只住在 meta 槽）
    const progress = migrate({ version: 11, savedAt: 0, data: { run: { actIndex: 0 } } });
    expect(progress?.data).toBeNull();

    // 已经带着断点的存档不被覆盖
    const kept = migrate({ version: 11, savedAt: 0, data: { achievements: [], tutorial: { classId: "engineer" } } });
    expect((kept?.data as { tutorial: { classId: string } }).tutorial).toEqual({ classId: "engineer" });
  });

  it("12 → 13：作废进行中的旧 run（回标题页），meta 全保留（docs/48 §六）", async () => {
    const { migrate, SCHEMA_VERSION } = await import("@/systems/save");
    expect(SCHEMA_VERSION).toBe(14);
    const progress = migrate({ version: 12, savedAt: 0, data: { run: { layerIndex: 4 }, deck: [] } });
    expect(progress?.version).toBe(SCHEMA_VERSION);
    expect(progress?.data).toBeNull();
    const meta = migrate({
      version: 12,
      savedAt: 0,
      data: {
        clearedClasses: ["bloodwright"],
        achievements: ["immortal"],
        unlocked: ["x"],
        tips: ["discard"],
        tutorial: { classId: "engineer" },
      },
    });
    expect(meta?.data).toEqual({
      clearedClasses: ["bloodwright"],
      achievements: ["immortal"],
      unlocked: ["x"],
      tips: ["discard"],
      tutorial: { classId: "engineer" },
    });
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
