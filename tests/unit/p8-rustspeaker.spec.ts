// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { createContentDb, type CardDefinition } from "@/core/registry";
import { loadGameContent } from "@/data/load";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import { TEST_CARDS, TEST_ENEMIES, handIndex } from "../helpers/combat";

/** docs/38 §二 · 1.0-B 锈语者引擎与内容。 */

const game = loadGameContent();
let seq = 0;

function start(opts: { deck: string[]; pollution?: number; energy?: number; enemies?: string[]; relics?: string[] }, content = game.content): BattleState {
  return reduce(
    createBattleState({
      battleId: "t",
      seed: 77,
      player: { maxHp: 66, energy: opts.energy ?? 9, ...(opts.pollution !== undefined ? { pollution: opts.pollution } : {}) },
      enemies: (opts.enemies ?? ["dummy"]).map((id) => ({ id })),
      deck: opts.deck,
      handSize: opts.deck.length,
      relics: opts.relics ?? [],
      content,
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

function play(state: BattleState, cardId: string, targetId?: string | null): BattleState {
  const handIndexValue = handIndex(state, cardId);
  return reduce(state, {
    type: "PlayCard",
    actionId: "p" + ++seq,
    handIndex: handIndexValue,
    ...(targetId ? { targetId } : {}),
  }).state;
}

describe("1.0-B 蚀锈 DoT", () => {
  it("蚀锈在敌方回合结束结算固定伤害并消耗 1 回合", () => {
    let s = start({ deck: ["rustspit", "strike", "strike"], enemies: ["rust_hound"] });
    const hp0 = s.enemies[0].hp;
    s = play(s, "rustspit", "rust_hound");
    const afterHit = s.enemies[0].hp;
    expect(afterHit).toBe(hp0 - 5);
    expect(s.enemies[0].buffs.find((b) => b.id === "corroding")?.stacks).toBe(2);
    const result = reduce(s, { type: "EndTurn", actionId: "e" });
    s = result.state;
    const tick = result.events.find((e) => e.type === "BuffTicked");
    expect(tick).toBeDefined();
    // 5 直接伤害 + 2 蚀锈 = 7
    expect(hp0 - s.enemies[0].hp).toBe(7);
    // 2 回合 → 递减为 1
    expect(s.enemies[0].buffs.find((b) => b.id === "corroding")?.duration).toBe(1);
  });
});

describe("1.0-B 污染收支引擎", () => {
  it("transferPollution：2:1 转移（自身 −20，目标 +10 蚀锈）", () => {
    let s = start({ deck: ["blacktransfusion", "strike"], pollution: 40, enemies: ["dummy"] });
    s = play(s, "blacktransfusion", "dummy");
    expect(s.player.pollution).toBe(20);
    expect(s.enemies[0].buffs.find((b) => b.id === "corroding")?.stacks).toBe(10);
  });

  it("spendPollution：消耗全部污染，每点换固定结算", () => {
    const dump: CardDefinition = {
      id: "dump",
      class: "bloodwright",
      type: "attack",
      rarity: "common",
      cost: 0,
      effects: [{ kind: "spendPollution", target: { type: "chosenEnemy" }, value: 2 }],
    };
    const content = createContentDb({
      cards: new Map([...TEST_CARDS, dump].map((c) => [c.id, c])),
      enemies: new Map(TEST_ENEMIES.map((e) => [e.id, e])),
      enhancements: new Map(),
    });
    let s = start({ deck: ["dump", "strike"], pollution: 30, enemies: ["dummy"] }, content);
    s = play(s, "dump", "dummy");
    expect(s.player.pollution).toBe(0);
    // 30 × 2 = 60，dummy 只有 50 → 击杀
    expect(s.enemies[0].hp).toBe(0);
  });

  it("consumeCorroding：先叠蚀锈再兑现（14 + 3×3 = 23）", () => {
    let s = start({ deck: ["venthex", "terminus", "strike"], enemies: ["rust_hound"] });
    s = play(s, "venthex", "rust_hound");
    const hp0 = s.enemies[0].hp;
    s = play(s, "terminus", "rust_hound");
    expect(hp0 - s.enemies[0].hp).toBe(23);
    expect(s.enemies[0].buffs.find((b) => b.id === "corroding")).toBeUndefined();
  });
});

describe("1.0-B 反噬与目标条件", () => {
  it("铁胃：反噬伤害减半（污染触顶 10 → 5）", () => {
    let s = start({ deck: ["ironstomach", "toxsip", "strike"], pollution: 95, energy: 9 });
    s = play(s, "ironstomach");
    const hp0 = s.player.hp;
    s = play(s, "toxsip");
    expect(s.player.pollution).toBeLessThan(100);
    expect(hp0 - s.player.hp).toBe(5);
  });

  it("targetHasBuff：疫触对已有蚀锈的目标追加伤害", () => {
    let s = start({ deck: ["venthex", "plaguetouch", "strike"], enemies: ["rust_hound"] });
    s = play(s, "venthex", "rust_hound");
    const hp0 = s.enemies[0].hp;
    s = play(s, "plaguetouch", "rust_hound");
    expect(hp0 - s.enemies[0].hp).toBe(10);
  });

  it("onPollutionMax 九十九：污染触顶改为 99 并获得力量，不反噬", () => {
    let s = start({ deck: ["ninety_nine", "guzzle", "strike"], pollution: 80, energy: 9 });
    const hp0 = s.player.hp;
    s = play(s, "ninety_nine");
    s = play(s, "guzzle");
    expect(s.player.pollution).toBe(99);
    expect(s.player.hp).toBe(hp0);
    expect(s.player.buffs.find((b) => b.id === "strength")?.stacks).toBe(5);
  });
});

describe("1.0-B 职业与解锁", () => {
  it("锈语者：双职业各通关一次才解锁", () => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    const meta = useMetaStore();
    expect(meta.isUnlocked("both_classes_clear")).toBe(false);
    meta.markCleared("bloodwright");
    expect(meta.isUnlocked("both_classes_clear")).toBe(false);
    meta.markCleared("engineer");
    expect(meta.isUnlocked("both_classes_clear")).toBe(true);
  });

  it("起手卡组：三职业各 10 张且无重复规则沿用", () => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    const run = useRunStore();
    for (const id of ["bloodwright", "engineer", "rustspeaker"]) {
      run.startRun(id, 3);
      expect(run.deck).toHaveLength(10);
      // 随身遗物改为首胜后三选一：开局只有身份件
      expect(run.relics).toEqual([
        id === "bloodwright" ? "broken_oil" : id === "engineer" ? "dentedcoil" : "rust_rosary",
      ]);
    }
  });

  it("锈语者卡奖只出 rustspeaker 卡", () => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    const run = useRunStore();
    run.startRun("rustspeaker", 11);
    for (const id of run.cardRewards()) {
      expect(run.cardDef(id)?.class).toBe("rustspeaker");
    }
  });
});
