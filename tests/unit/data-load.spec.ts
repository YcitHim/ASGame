import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { loadGameContent } from "@/data/load";

function battleFromAct(seed: number): BattleState {
  const game = loadGameContent();
  const act = game.acts[0];
  const encounter = act.encounters[0];
  return createBattleState({
    battleId: "smoke",
    seed,
    player: act.player,
    enemies: encounter.enemies.map((id) => ({ id })),
    deck: act.startDeck,
    content: game.content,
  });
}

describe("真实内容装载（data/load）", () => {
  it("卡牌 / 敌人 / 关卡 / 文案全部可用，敌人名按 i18n 解析", () => {
    const game = loadGameContent();
    expect(game.content.cards.size).toBeGreaterThanOrEqual(6);
    expect(game.content.enemies.size).toBe(3);
    expect(game.acts).toHaveLength(1);
    expect(game.content.enemies.get("rust_hound")?.name).toBe("锈蚀猎犬");
    expect(game.i18n["card.strike.name"]).toBe("打击");
  });

  it("起手卡组全部能在目录中找到定义", () => {
    const game = loadGameContent();
    for (const act of game.acts) {
      for (const cardId of act.startDeck) expect(game.content.cards.has(cardId), cardId).toBe(true);
    }
  });
});

describe("真实内容可打通一场战斗（S3 门禁：UI 胜/负两条路径）", () => {
  it("攻击优先地打，能推进到 battleEnd（胜或负都算流程走通）", () => {
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
    expect(state.player.hp).toBeGreaterThanOrEqual(0);
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
