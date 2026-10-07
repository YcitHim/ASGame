// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainEvent } from "@/core/events";
import { validatePlayCardState } from "@/core/combat";

/**
 * 音频接线（docs/43 Q1 / docs/45 Q10）：出牌 / 命中（敌我两种）/ 回合切换。
 * 这里把 systems/audio 整个换成 spy——验的是"什么时候响哪一声"，
 * 音色本身在 p21-audio.spec 里验。
 */
vi.mock("@/systems/audio", () => ({
  playSfx: vi.fn(),
  unlockAudio: vi.fn(() => true),
  applyVolumes: vi.fn(),
  startBgm: vi.fn(),
  stopBgm: vi.fn(),
  isAudioMuted: vi.fn(() => false),
  isBgmPlaying: vi.fn(() => false),
  isAudioUnlocked: vi.fn(() => true),
  previewSfx: vi.fn(),
  previewBgm: vi.fn(),
  resetAudioForTest: vi.fn(),
  SFX_IDS: ["cardPlay", "hitEnemy", "hitPlayer", "turn"],
}));

// 必须在 mock 之后 import
const { playSfx } = await import("@/systems/audio");
const { useBattleStore } = await import("@/stores/battle");
const { useRunStore } = await import("@/stores/run");

function boot() {
  setActivePinia(createPinia());
  const run = useRunStore();
  run.startRun("bloodwright", 1);
  const battle = useBattleStore();
  battle.start();
  battle.skip();
  return battle;
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

async function until(fn: () => boolean, ms = 3000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return fn();
}

describe("音频接线 · 什么时候响哪一声", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  it("命中分敌我两种：打敌人一声、自己挨打另一声", () => {
    const battle = boot();
    const enemy = battle.battle!.enemies[0]!;
    battle.onAnimEvent(damage({ sourceId: "player", targetId: enemy.id, value: 5, hpLost: 5 }));
    expect(playSfx).toHaveBeenCalledWith("hitEnemy");
    vi.clearAllMocks();
    battle.onAnimEvent(damage({ sourceId: enemy.id, targetId: "player", value: 5, hpLost: 5 }));
    expect(playSfx).toHaveBeenCalledWith("hitPlayer");
    expect(playSfx).not.toHaveBeenCalledWith("hitEnemy");
  });

  it("回合切换：TurnStarted 一声", () => {
    const battle = boot();
    battle.onAnimEvent({ type: "TurnStarted", seq: 1, actionId: "t", turn: 2 } as DomainEvent);
    expect(playSfx).toHaveBeenCalledWith("turn");
  });

  it("出牌：真实打出第一张能打的牌，动画链上响一声出牌音", async () => {
    const battle = boot();
    const hand = battle.battle!.piles.hand;
    let index = -1;
    let target: string | null = null;
    for (let i = 0; i < hand.length; i += 1) {
      const check = validatePlayCardState(battle.battle!, i, null);
      if (check.ok) {
        index = i;
        break;
      }
      if (check.reason === "需要指定目标") {
        index = i;
        target = battle.battle!.enemies[0]!.id;
        break;
      }
    }
    expect(index, "开局手牌里应该至少有一张能打").toBeGreaterThanOrEqual(0);
    battle.playCard(index, target);
    const heard = await until(() => vi.mocked(playSfx).mock.calls.some((c) => c[0] === "cardPlay"));
    expect(heard, "出牌应该响一声 cardPlay").toBe(true);
    battle.skip();
  });

  it("skip() 一并跳过声音（不会在跳过整套连击时哐哐哐放完）", async () => {
    const battle = boot();
    for (let i = 0; i < 3; i += 1) {
      battle.onAnimEvent(damage({ sourceId: "player", targetId: battle.battle!.enemies[0]!.id, value: 3, hpLost: 3 }));
    }
    expect(vi.mocked(playSfx).mock.calls.length).toBe(3);
    vi.clearAllMocks();
    battle.skip();
    await new Promise((r) => setTimeout(r, 60));
    expect(playSfx).not.toHaveBeenCalled();
  });
});
