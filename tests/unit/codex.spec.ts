import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useCodexStore } from "@/stores/codex";

/** 图鉴「见过即解锁」（docs/16 4.7）：点亮 + 持久化。 */

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

describe("图鉴 codex store", () => {
  beforeEach(() => {
    installLocalStorage();
    setActivePinia(createPinia());
  });

  it("未见过为 false，点亮后为 true 且落盘", () => {
    const codex = useCodexStore();
    codex.ensureLoaded();
    expect(codex.cardSeen("strike")).toBe(false);
    codex.markCards(["strike", "bloodbolt"]);
    codex.markRelics(["broken_oil"]);
    codex.markEnemies(["rust_hound"]);
    expect(codex.cardSeen("strike")).toBe(true);
    expect(codex.relicSeen("broken_oil")).toBe(true);
    expect(codex.enemySeen("rust_hound")).toBe(true);

    // 新 store 从存档恢复
    setActivePinia(createPinia());
    const reloaded = useCodexStore();
    reloaded.ensureLoaded();
    expect(reloaded.cardSeen("strike")).toBe(true);
    expect(reloaded.enemySeen("rust_hound")).toBe(true);
  });

  it("重复点亮不产生重复项", () => {
    const codex = useCodexStore();
    codex.markCards(["strike", "strike"]);
    codex.markCards(["strike"]);
    expect(codex.seenCards).toEqual(["strike"]);
  });
});
