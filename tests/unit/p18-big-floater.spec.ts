// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useBattleStore } from "@/stores/battle";
import { useRunStore } from "@/stores/run";
import type { DomainEvent } from "@/core/events";

/**
 * docs/51 §一「重读数」：四档事件级大字 + 防刷屏。
 * 这里直接喂事件给 onAnimEvent（事件流是只读输入，不需要真打一场）。
 */
function boot() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const run = useRunStore();
  run.startRun("bloodwright", 1);
  const battle = useBattleStore();
  battle.start();
  battle.skip();
  return { run, battle };
}

function damage(over: Partial<Extract<DomainEvent, { type: "DamageDealt" }>> = {}): DomainEvent {
  return {
    type: "DamageDealt",
    seq: 1,
    actionId: "t",
    sourceId: "rust_hound",
    targetId: "player",
    base: 0,
    layers: [],
    value: 0,
    blocked: 0,
    hpLost: 0,
    segment: 1,
    segments: 1,
    ...over,
  } as DomainEvent;
}

describe("docs/51 §一 · 重读数", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("① 重创：玩家单次受伤 ≥ 最大 HP 15% → 血红大字，小飘字不重复报", () => {
    const { battle } = boot();
    const maxHp = battle.battle!.player.maxHp;
    battle.onAnimEvent(damage({ hpLost: Math.ceil(maxHp * 0.15), value: Math.ceil(maxHp * 0.15) }));
    expect(battle.bigFloater?.tier).toBe("wound");
    expect(battle.bigFloater?.text).toContain("−");
    expect(battle.floaters.some((f) => f.kind === "damage")).toBe(false);
  });

  it("小伤害不触发重读数，走常规飘字", () => {
    const { battle } = boot();
    battle.onAnimEvent(damage({ hpLost: 3, value: 3 }));
    expect(battle.bigFloater).toBeNull();
    expect(battle.floaters.some((f) => f.kind === "damage" && f.value === 3)).toBe(true);
  });

  it("② 完全格挡：单发被全挡 ≥ 15% 最大 HP → 冰蓝「完全格挡！」，不再报小字「格挡！」", () => {
    const { battle } = boot();
    const maxHp = battle.battle!.player.maxHp;
    battle.onAnimEvent(damage({ hpLost: 0, blocked: Math.ceil(maxHp * 0.15), value: Math.ceil(maxHp * 0.15) }));
    expect(battle.bigFloater?.tier).toBe("guard");
    expect(battle.bigFloater?.text).toBe("完全格挡！");
    expect(battle.floaters.some((f) => f.text === "格挡！")).toBe(false);
  });

  it("③ 重击：玩家单次造成 ≥ 目标最大 HP 30%（且不低于 12）→ 锈金大字", () => {
    const { battle } = boot();
    const target = battle.battle!.enemies[0]!;
    const need = Math.max(12, Math.ceil(target.maxHp * 0.3));
    battle.onAnimEvent(damage({ sourceId: "player", targetId: target.id, value: need - 1, hpLost: need - 1 }));
    expect(battle.bigFloater).toBeNull();
    battle.onAnimEvent(damage({ sourceId: "player", targetId: target.id, value: need, hpLost: need }));
    expect(battle.bigFloater?.tier).toBe("heavy");
    expect(battle.bigFloater?.text).toContain("−");
  });

  it("④ 致命：精英 / Boss 节点上击杀 → 描金「击溃」", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const run = useRunStore();
    run.startRun("bloodwright", 1);
    for (let i = 0; i < 9; i += 1) run.advance(); // l9 = Boss
    const battle = useBattleStore();
    battle.start();
    battle.skip();
    expect(run.current?.kind).toBe("boss");
    battle.onAnimEvent({ type: "UnitDied", seq: 1, actionId: "t", unitId: "rust_throat", clearedEffects: 0 } as DomainEvent);
    expect(battle.bigFloater?.tier).toBe("finish");
    expect(battle.bigFloater?.text).toBe("击溃");
  });

  it("防刷屏：0.4s 内的第二条重读数回落成常规飘字（绝不少报伤害）", () => {
    const { battle } = boot();
    const maxHp = battle.battle!.player.maxHp;
    const hit = Math.ceil(maxHp * 0.15);
    battle.onAnimEvent(damage({ hpLost: hit, value: hit }));
    const first = battle.bigFloater?.id;
    battle.onAnimEvent(damage({ hpLost: hit, value: hit }));
    expect(battle.bigFloater?.id).toBe(first);
    // 第二条回落成常规飘字
    expect(battle.floaters.filter((f) => f.kind === "damage").length).toBe(1);
  });

  it("skip() 把重读数一并清掉（跳过动画不留残影）", () => {
    const { battle } = boot();
    const maxHp = battle.battle!.player.maxHp;
    battle.onAnimEvent(damage({ hpLost: Math.ceil(maxHp * 0.15), value: Math.ceil(maxHp * 0.15) }));
    expect(battle.bigFloater).not.toBeNull();
    battle.skip();
    expect(battle.bigFloater).toBeNull();
  });
});
