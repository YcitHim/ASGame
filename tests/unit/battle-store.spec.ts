import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useBattleStore } from "@/stores/battle";

describe("battleStore（UI 投影 + 动画队列）", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("start：初始化战斗、揭示意图、事件入日志", () => {
    const store = useBattleStore();
    store.start();
    const battle = store.battle;
    expect(battle).not.toBeNull();
    expect(battle?.phase).toBe("playerAction");
    expect(store.log.some((e) => e.type === "BattleStarted")).toBe(true);
    expect(store.log.some((e) => e.type === "IntentRevealed")).toBe(true);
    expect(store.over).toBe(false);
    store.skip();
  });

  it("selectCard 出牌、endTurn 推进、debug 生效、倍速切换", () => {
    const store = useBattleStore();
    store.start();
    store.skip();

    const battle = store.battle!;
    const defendIndex = battle.piles.hand.findIndex((id) => battle.cardInstances[id].cardId === "defend");
    if (defendIndex >= 0) {
      store.selectCard(defendIndex);
      store.skip();
      expect(store.battle!.player.block).toBeGreaterThanOrEqual(5);
    }

    const turnBefore = store.battle!.turn;
    store.endTurn();
    store.skip();
    expect(store.battle!.turn).toBe(turnBefore + 1);

    store.debug("set hp 50");
    expect(store.battle!.player.hp).toBe(50);

    store.toggleSpeed();
    expect(store.speed).toBe(2);
    store.toggleSpeed();
    expect(store.speed).toBe(1);
  });

  it("非法出牌给出可读拒绝理由", () => {
    const store = useBattleStore();
    store.start();
    store.skip();
    store.selectCard(99);
    expect(store.message).toBe("手牌索引非法");
  });
});
