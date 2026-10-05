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

  it("阵亡后重开：满血新局、结算弹窗归位（回归 bug）", () => {
    const store = useBattleStore();
    store.start();
    store.skip();
    store.debug("set hp 0");
    store.skip();
    expect(store.result).toBe("lose");
    expect(store.over).toBe(true);
    expect(store.battle?.player.hp).toBe(0);

    // 直接 start（标题「继续远征」路径）也不能用 0 HP 开局
    store.start();
    store.skip();
    expect(store.over).toBe(false);
    expect(store.battle!.player.hp).toBe(store.battle!.player.maxHp);

    // 再死一次，走「重新远征」按钮路径
    store.debug("set hp 0");
    store.skip();
    expect(store.over).toBe(true);
    store.restart();
    store.skip();
    expect(store.over).toBe(false);
    expect(store.battle!.phase).toBe("playerAction");
    expect(store.battle!.player.hp).toBe(store.battle!.player.maxHp);
  });

  it("非法出牌给出可读拒绝理由", () => {
    const store = useBattleStore();
    store.start();
    store.skip();
    store.selectCard(99);
    expect(store.message).toBe("手牌索引非法");
  });
});
