import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { loadGameContent } from "@/data/load";

function battleFromAct(seed: number): BattleState {
  const game = loadGameContent();
  const act = game.acts[0];
  const node = act.map.find((n) => n.kind === "battle");
  return createBattleState({
    battleId: "smoke",
    seed,
    player: act.player,
    enemies: (node?.enemies ?? []).map((id) => ({ id })),
    deck: act.startDeck,
    content: game.content,
  });
}

describe("真实内容装载（data/load）", () => {
  it("卡牌 / 敌人 / 关卡 / 文案全部可用，敌人名按 i18n 解析", () => {
    const game = loadGameContent();
    expect(game.content.cards.size).toBeGreaterThanOrEqual(30);
    expect(game.content.enemies.size).toBe(7);
    expect(game.content.relics.size).toBe(4);
    expect(game.acts).toHaveLength(1);
    expect(game.content.enemies.get("rust_hound")?.name).toBe("锈蚀猎犬");
    expect(game.content.enemies.get("rust_throat")?.name).toBe("锈喉");
    expect(game.i18n["card.strike.name"]).toBe("打击");
  });

  it("线性地图 7 节点（2 普通战 + 1 事件），含精英 / 休息 / 祭坛 / Boss", () => {
    const act = loadGameContent().acts[0];
    expect(act.map).toHaveLength(7);
    expect(act.map.map((n) => n.kind)).toEqual(["battle", "battle", "event", "elite", "rest", "altar", "boss"]);
    expect(act.map[1].enemies).toEqual(["corroded_swarm", "riveted_heavy"]);
    expect(act.map[2].events?.length).toBe(5);
    expect(act.map[6].enemies).toEqual(["rust_throat"]);
  });

  it("起手卡组全部能在目录中找到定义", () => {
    const game = loadGameContent();
    for (const act of game.acts) {
      for (const cardId of act.startDeck) expect(game.content.cards.has(cardId), cardId).toBe(true);
    }
  });
});

describe("真实内容可打通一场战斗", () => {
  it("攻击优先地打，能推进到 battleEnd", () => {
    const game = loadGameContent();
    let state = reduce(battleFromAct(20261005), { type: "Noop", actionId: "s" }).state;
    expect(state.phase).toBe("playerAction");

    let guard = 0;
    while (state.phase !== "battleEnd" && guard < 300) {
      guard += 1;
      const target = state.enemies.find((e) => e.hp > 0)?.id;
      const strikeIndex = state.piles.hand.findIndex((id) => state.cardInstances[id].cardId === "strike");
      const defendIndex = state.piles.hand.findIndex((id) => state.cardInstances[id].cardId === "defend");
      const playIndex = strikeIndex >= 0 ? strikeIndex : defendIndex;
      if (playIndex >= 0) {
        const cardId = state.cardInstances[state.piles.hand[playIndex]].cardId;
        const cost = game.content.cards.get(cardId)?.cost ?? 9;
        if (cost <= state.player.energy) {
          state = reduce(state, {
            type: "PlayCard",
            actionId: `p${guard}`,
            handIndex: playIndex,
            ...(cardId === "strike" && target ? { targetId: target } : {}),
          }).state;
          continue;
        }
      }
      state = reduce(state, { type: "EndTurn", actionId: `e${guard}` }).state;
    }
    expect(state.phase).toBe("battleEnd");
  });

  it("低血量可被打死 → lose 路径可达", () => {
    let state = reduce(battleFromAct(7), { type: "Noop", actionId: "s" }).state;
    state = reduce(state, { type: "DebugCommand", actionId: "d", command: "set hp 1" }).state;
    let guard = 0;
    while (state.phase !== "battleEnd" && guard < 20) {
      guard += 1;
      state = reduce(state, { type: "EndTurn", actionId: `e${guard}` }).state;
    }
    expect(state.phase).toBe("battleEnd");
    expect(state.player.hp).toBe(0);
  });
});
