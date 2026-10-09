import { describe, expect, it } from "vitest";
import { createRunState, resolveEventOption, rollCardRewards, CLASS_POOL_SHARE } from "@/core/map";
import { loadGameContent } from "@/data/load";

/**
 * docs/56 R2：分组重划后的抽取口径——奖励每槽 70% 职业 / 30% 中立、
 * 显式池按「职业可用性」过滤（本职业 + 中立），过滤后为空退化为中立池。
 */
const game = loadGameContent();
const content = game.content;
const act = game.acts[0];
const cls = (id: string) => content.classes.get(id)!;

describe("docs/56 · 卡池分组", () => {
  it("归属表与文档一致（衍生物不计入）：中立 23 / 血械 20 / 炉心 29 / 锈语者 32", () => {
    const count = (id: string) =>
      [...content.cards.values()].filter((c) => c.class === id && c.token !== true).length;
    expect(count("neutral")).toBe(23);
    expect(count("bloodwright")).toBe(20);
    expect(count("engineer")).toBe(29);
    expect(count("rustspeaker")).toBe(32);
  });

  it("中立卡不含身份机制（分组铁律的运行时影子；validator 是机器看守）", () => {
    for (const c of content.cards.values()) {
      if (c.class !== "neutral") continue;
      expect(c.keywords ?? [], c.id).not.toContain("bloodpact");
      expect(c.bloodCost ?? 0, c.id).toBe(0);
      expect(c.chargeCost ?? 0, c.id).toBe(0);
    }
  });

  it("战斗奖励：每槽独立掷 70/30，中立池真的进得来", () => {
    const run = createRunState(act, cls("bloodwright"), 4242, { unlocked: [] });
    let neutral = 0;
    let total = 0;
    for (let node = 0; node < 200; node += 1) {
      const picks = rollCardRewards(content, act, run, node);
      expect(new Set(picks).size, "同一次三选一不重复").toBe(picks.length);
      for (const id of picks) {
        const card = content.cards.get(id)!;
        expect(["bloodwright", "neutral"]).toContain(card.class);
        if (card.class === "neutral") neutral += 1;
        total += 1;
      }
    }
    const share = neutral / total;
    // CLASS_POOL_SHARE 是「职业」那一侧，中立的期望份额是它剩下的部分
    const expected = 1 - CLASS_POOL_SHARE;
    // 200 节点 × 3 槽的确定性抽样，允许比例抖动但不允许「中立根本不出现」或「中立占大头」
    expect(share).toBeGreaterThan(expected - 0.15);
    expect(share).toBeLessThan(expected + 0.15);
  });

  it("事件显式池：非本职业 → 退化为中立池（拔掉 docs/16 的保留原池补丁）", () => {
    const ctx = (classId: string) => ({ seed: 7, ownedRelics: [], classId, maxHp: 66, hp: 66, pollution: 0 });
    const pool = ["chargeup", "sparkjab", "redline", "discharge"];
    // 血械局：这 4 张现在都是炉心身份卡 → 过滤后为空 → 发中立卡（不再发死牌）
    const forBlood = resolveEventOption(content, content.events.get("power_station")!, "a", ctx("bloodwright"));
    expect(forBlood?.cardIds).toHaveLength(1);
    expect(content.cards.get(forBlood!.cardIds[0])?.class).toBe("neutral");
    // 炉心局：原池照常
    const forEng = resolveEventOption(content, content.events.get("power_station")!, "a", ctx("engineer"));
    expect(pool).toContain(forEng!.cardIds[0]);
  });

  it("事件无显式池：与奖励同口径（本职业 + 中立）", () => {
    const run = createRunState(act, cls("engineer"), 99, { unlocked: [] });
    for (let node = 0; node < 40; node += 1) {
      const res = resolveEventOption(content, content.events.get("blood_trader")!, "b", {
        seed: 1000 + node,
        ownedRelics: [],
        classId: run.classId,
        maxHp: 66,
        hp: 66,
        pollution: 0,
      });
      expect(res?.cardIds).toHaveLength(1);
      expect(["engineer", "neutral"]).toContain(content.cards.get(res!.cardIds[0])?.class);
    }
  });
});
