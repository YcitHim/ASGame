import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { loadGameContent } from "@/data/load";

function battleFromAct(seed: number): BattleState {
  const game = loadGameContent();
  const act = game.acts[0];
  const cls = game.content.classes.get("bloodwright")!;
  // 分支地图：入口层（l0）是必经战斗，用它的首个遭遇池做冒烟
  const enemies = act.layers[0]?.encounters?.[0]?.enemies ?? [];
  return createBattleState({
    battleId: "smoke",
    seed,
    player: cls.player,
    enemies: enemies.map((id) => ({ id })),
    deck: cls.startDeck,
    content: game.content,
  });
}

describe("真实内容装载（data/load）", () => {
  it("卡牌 / 敌人 / 关卡 / 文案全部可用，敌人名按 i18n 解析", () => {
    const game = loadGameContent();
    expect(game.content.cards.size).toBeGreaterThanOrEqual(30);
    expect(game.content.enemies.size).toBe(18);
    expect(game.content.relics.size).toBe(25);
    expect(game.content.classes.size).toBe(3);
    // 两幕：锈蚀回廊 + 沉没圣堂（docs/40）
    expect(game.acts).toHaveLength(2);
    expect(game.acts[1].id).toBe("act2");
    expect(game.content.enemies.get("rust_hound")?.name).toBe("锈蚀猎犬");
    expect(game.content.enemies.get("rust_throat")?.name).toBe("锈喉");
    expect(game.i18n["card.strike.name"]).toBe("打击");
  });

  it("分支地图层模板：入口/精英/汇合/Boss，分支层带遭遇与事件池", () => {
    const act = loadGameContent().acts[0];
    expect(act.layers).toHaveLength(8);
    expect(act.weights).toEqual({ battle: 40, elite: 15, rest: 15, altar: 15, event: 15 });
    // 入口必经战斗、精英层、Boss 层
    expect(act.layers[0].width).toBe(1);
    expect(act.layers[0].kinds).toEqual(["battle"]);
    expect(act.layers[3].kinds).toEqual(["elite"]);
    expect(act.layers[3].enemies).toEqual(["rust_warden"]);
    expect(act.layers[7].kinds).toEqual(["boss"]);
    expect(act.layers[7].enemies).toEqual(["rust_throat"]);
    // 精英后（l4=休息）与 Boss 前（l6=祭坛）各一个汇合点（width=1）
    expect(act.layers[4].width).toBe(1);
    expect(act.layers[4].kinds).toEqual(["rest"]);
    expect(act.layers[6].width).toBe(1);
    expect(act.layers[6].kinds).toEqual(["altar"]);
    // 分支层：3 选 1，带遭遇池与事件池
    expect(act.layers[1].width).toBe(3);
    expect(act.layers[1].encounters?.length).toBe(3);
    expect(act.layers[1].events?.length).toBe(5);
  });

  it("同种子生成同一张分支地图；不同种子不同（map 流独立可复现）", async () => {
    const { generateActMap } = await import("@/core/map");
    const act = loadGameContent().acts[0];
    const a = generateActMap(act, 12345);
    const b = generateActMap(act, 12345);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toHaveLength(8);
    // 分支层数量正确
    expect(a[1].nodes).toHaveLength(3);
    expect(a[3].nodes).toHaveLength(1);
    // 分支层节点 id 唯一
    const ids = a.flatMap((l) => l.nodes.map((n) => n.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("敌人不会连续两回合防御（玩家反馈：防御后又防御）", () => {
    const game = loadGameContent();
    for (const enemy of game.content.enemies.values()) {
      for (const entry of enemy.intents) {
        if (entry.intent.kind !== "defend") continue;
        expect(entry.maxConsecutive, `${enemy.id} 的防御意图必须限 1 次连续`).toBe(1);
      }
    }
  });

  it("起手卡组全部能在目录中找到定义", () => {
    const game = loadGameContent();
    for (const cls of game.content.classes.values()) {
      for (const cardId of cls.startDeck) expect(game.content.cards.has(cardId), cardId).toBe(true);
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
