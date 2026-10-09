import { describe, expect, it } from "vitest";
import { resolveEventOption } from "@/core/map";
import { loadGameContent } from "@/data/load";

const game = loadGameContent();

describe("docs/66 批 3 · 锻炉事件", () => {
  it("三幕事件池恰为 6 件且全在池内（docs/70 §3.4：过 validator「池 ≥6」门禁）", () => {
    const act3 = game.acts.find((a) => a.id === "act3")!;
    const pool = [...new Set(act3.layers.flatMap((l) => l.events ?? []))];
    expect(pool.sort()).toEqual(
      ["ash_oracle", "cinder_offering", "forge_baptism", "heart_whisper", "quench_trial", "slag_merchant"].sort(),
    );
    for (const id of pool) expect(game.content.events.has(id), `事件 ${id} 不在内容库`).toBe(true);
    // 挂载位置与一二幕同构：l1 / l5 各一份，其余中段层靠 inheritedPool 继承
    expect(act3.layers[1]!.events).toHaveLength(6);
    expect(act3.layers[5]!.events).toHaveLength(6);
  });

  it("两个事件已入内容库，骨架与设计一致", () => {
    const baptism = game.content.events.get("forge_baptism")!;
    expect(baptism).toBeTruthy();
    expect(baptism.options.find((o) => o.id === "a")!.effects).toEqual([
      { kind: "maxHp", value: 8 },
      { kind: "pollution", value: 15 },
    ]);
    const merchant = game.content.events.get("slag_merchant")!;
    expect(merchant).toBeTruthy();
    expect(merchant.options.find((o) => o.id === "a")!.effects).toEqual([
      { kind: "loseRelic", tier: 1 },
      { kind: "gainRelic", tier: 2 },
    ]);
    // 拒绝分支必须是「无效果」，否则文案与结算会对不上
    for (const def of [baptism, merchant]) expect(def.options.find((o) => o.id === "b")!.effects).toBeUndefined();
  });

  it("tier 过滤真的收窄池子：炉渣商人只当 T1、只给 T2", () => {
    const def = game.content.events.get("slag_merchant")!;
    const res = resolveEventOption(game.content, def, "a", {
      seed: 7,
      ownedRelics: ["bandage", "insul_brick"], // 一件 T1 + 一件 T2
      classId: "bloodwright",
      unlocked: [],
      maxHp: 70,
      hp: 70,
      pollution: 0,
      identityRelics: [],
      deckUpgradeable: [],
    })!;
    // 只当掉 T1 那件（insul_brick 是 T2，不在 tier:1 池里）
    expect(res.loseRelicIds).toEqual(["bandage"]);
    // 给的必须是 T2，且不能是刚当掉/已持有的
    expect(res.relicIds).toHaveLength(1);
    expect(game.content.relics.get(res.relicIds[0]!)!.tier).toBe(2);
    expect(res.relicIds[0]).not.toBe("insul_brick");
  });

  it("锻炉洗礼：最大生命 +8 与污染 +15 都按文档落数", () => {
    const def = game.content.events.get("forge_baptism")!;
    const res = resolveEventOption(game.content, def, "a", {
      seed: 1,
      ownedRelics: [],
      classId: "bloodwright",
      unlocked: [],
      maxHp: 70,
      hp: 70,
      pollution: 0,
      identityRelics: [],
      deckUpgradeable: [],
    })!;
    expect(res.maxHpDelta).toBe(8);
    expect(res.pollutionDelta).toBe(15);
  });

  it("拒绝分支：零结算（不该偷偷改任何东西）", () => {
    const def = game.content.events.get("forge_baptism")!;
    const res = resolveEventOption(game.content, def, "b", {
      seed: 1,
      ownedRelics: [],
      classId: "bloodwright",
      unlocked: [],
      maxHp: 70,
      hp: 70,
      pollution: 0,
      identityRelics: [],
      deckUpgradeable: [],
    })!;
    expect(res.maxHpDelta).toBe(0);
    expect(res.pollutionDelta).toBe(0);
    expect(res.relicIds).toEqual([]);
    expect(res.loseRelicIds).toEqual([]);
  });
});
