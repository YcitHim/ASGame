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
    expect(meta?.data).toEqual({ clearedClasses: ["bloodwright"], unlocked: [] });
  });

  it("来自未来版本的存档不猜，直接丢弃", () => {
    localStorage.setItem(slotKey("progress"), JSON.stringify({ version: SCHEMA_VERSION + 5, data: {} }));
    expect(readSlot("progress", "fallback")).toBe("fallback");
  });
});

describe("settings 归一化", () => {
  it("越界音量被夹紧、非法字段回落默认", async () => {
    const { normalizeSettings, DEFAULT_SETTINGS } = await import("@/stores/settings");
    const s = normalizeSettings({ masterVolume: 5, bgmVolume: -3, screenShake: "yes" as never });
    expect(s.masterVolume).toBe(1);
    expect(s.bgmVolume).toBe(0);
    expect(s.screenShake).toBe(DEFAULT_SETTINGS.screenShake);
    expect(s.animationSpeed).toBe(1);
    expect(s.language).toBe("zh-CN");
  });
});
