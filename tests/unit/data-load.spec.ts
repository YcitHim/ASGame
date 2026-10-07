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

  it("树状地图层模板：10 层骨架 / 精英池 / 收尾祭坛→Boss（docs/48 §3.1）", () => {
    const act = loadGameContent().acts[0];
    expect(act.layers).toHaveLength(10);
    expect(act.weights).toEqual({ battle: 40, elite: 15, rest: 15, altar: 15, event: 15 });
    // 入口必经战斗、收尾祭坛 → Boss
    expect(act.layers[0].width).toBe(1);
    expect(act.layers[0].kinds).toEqual(["battle"]);
    expect(act.layers[8].width).toBe(1);
    expect(act.layers[8].kinds).toEqual(["altar"]);
    expect(act.layers[9].width).toBe(1);
    expect(act.layers[9].kinds).toEqual(["boss"]);
    expect(act.layers[9].enemies).toEqual(["rust_throat"]);
    // 精英池挂 l2~l6；l1 / l7 不出精英（docs/48 §3.2）
    for (const i of [2, 3, 4, 5, 6]) expect(act.layers[i].elitePool).toEqual(["rust_warden"]);
    expect(act.layers[1].kinds).not.toContain("elite");
    expect(act.layers[7].kinds).not.toContain("elite");
    // 中段层带遭遇池与事件池
    expect(act.layers[1].encounters?.length).toBe(3);
    expect(act.layers[1].events?.length).toBe(5);
  });

  it("同种子生成同一张分支地图；不同种子不同（map 流独立可复现）", async () => {
    const { generateActMap } = await import("@/core/map");
    const act = loadGameContent().acts[0];
    const a = generateActMap(act, 12345);
    const b = generateActMap(act, 12345);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toHaveLength(10);
    // docs/48 §3.1 修订 1：起点 / 祭坛 / Boss 单节点，中间层 2~4
    expect(a[0].nodes).toHaveLength(1);
    expect(a[8].nodes).toHaveLength(1);
    expect(a[9].nodes).toHaveLength(1);
    for (const idx of [1, 2, 3, 4, 5, 6, 7]) {
      expect(a[idx].nodes.length, `l${idx}`).toBeGreaterThanOrEqual(2);
      expect(a[idx].nodes.length, `l${idx}`).toBeLessThanOrEqual(4);
      expect(a[idx].nodes.filter((n) => n.kind === "elite").length).toBeLessThanOrEqual(1);
      expect(a[idx].nodes.filter((n) => n.kind === "rest").length).toBeLessThanOrEqual(1);
    }
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
