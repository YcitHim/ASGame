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
    // docs/47 M1/M2 4 只 + M3 3 只（鼓腹兽 / 藤壶寄居者 / 锈蛆）；
    // 后续批次继续加敌人（如 2026-10-08 第二幕扩充），故用下界断言，别写死。
    expect(game.content.enemies.size).toBeGreaterThanOrEqual(25);
    expect(game.content.relics.size).toBe(37);
    expect(game.content.classes.size).toBe(3);
    // 三幕：锈蚀回廊 + 沉没圣堂 + 锈心锻炉（docs/66 §四 10 层定稿）
    expect(game.acts).toHaveLength(3);
    expect(game.acts[1].id).toBe("act2");
    expect(game.acts[2].id).toBe("act3");
    expect(game.content.enemies.get("rust_hound")?.name).toBe("锈蚀猎犬");
    expect(game.content.enemies.get("rust_throat")?.name).toBe("锈喉");
    expect(game.content.enemies.get("rust_bell_penitent")?.name).toBe("锈钟忏悔者");
    expect(game.content.enemies.get("chain_flailer")?.name).toBe("蚀锁链枷手");
    expect(game.content.enemies.get("rust_moth")?.name).toBe("蚀骨锈蛾");
    expect(game.content.enemies.get("silent_matron")?.name).toBe("静默嬷嬷");
    expect(game.i18n["card.strike.name"]).toBe("打击");
  });

  it("树状地图层模板：10 层骨架 / 精英池 / 收尾祭坛→Boss（docs/48 §3.1）", () => {
    const act = loadGameContent().acts[0];
    expect(act.layers).toHaveLength(10);
    // docs/49 §六：中段环境配比 战斗 50 / 事件 20 / 匣 15 / 祭坛 15
    expect(act.weights).toEqual({ battle: 50, elite: 15, rest: 15, altar: 15, event: 20, reward: 15 });
    // 入口必经战斗、收尾祭坛 → Boss
    expect(act.layers[0].width).toBe(1);
    expect(act.layers[0].kinds).toEqual(["battle"]);
    expect(act.layers[8].width).toBe(1);
    expect(act.layers[8].kinds).toEqual(["altar"]);
    expect(act.layers[9].width).toBe(1);
    expect(act.layers[9].kinds).toEqual(["boss"]);
    expect(act.layers[9].enemies).toEqual(["rust_throat"]);
    // 精英池挂 l2~l6；l1 / l7 不出精英（docs/48 §3.2）
    // docs/47 §四.2：act1 精英池扩到 3 只，精英节点不再撞衫
    for (const i of [2, 3, 4, 5, 6]) {
      expect(act.layers[i].elitePool).toEqual(["rust_warden", "rust_bell_penitent", "chain_flailer", "forge_colossus"]);
    }
    expect(act.layers[1].kinds).not.toContain("elite");
    expect(act.layers[7].kinds).not.toContain("elite");
    // 中段层带遭遇池与事件池（遭遇池 3 → 4：新增釉壳残躯，见 docs/62 后续批次）
    expect(act.layers[1].encounters?.length).toBe(4);
    // docs/54 §五：act1 事件池 5 → 10（新增 5 件，配比门禁写进 validator）
    expect(act.layers[1].events?.length).toBe(10);
    expect(loadGameContent().acts[1].layers[1].events?.length).toBe(9);
  });

  // 甲方 2026-10-07：牌库里「压簧」与「支撑」一字不差 —— 加一条护栏，防止再出现同构牌
  it("付费牌库没有两张一模一样的牌（忽略 id / 职业 / 文案）", () => {
    const cards = [...loadGameContent().content.cards.values()];
    const body = (c: (typeof cards)[number]) => {
      const raw = { ...(c as unknown as Record<string, unknown>) };
      delete raw.id;
      delete raw.class;
      delete raw.i18n;
      return JSON.stringify(raw);
    };
    const byBody = new Map<string, string[]>();
    for (const c of cards) byBody.set(body(c), [...(byBody.get(body(c)) ?? []), c.id]);
    const dupes = [...byBody.values()].filter((ids) => ids.length > 1);
    expect(dupes, "出现完全同构的卡牌：" + dupes.map((ids) => ids.join(" / ")).join(" · ")).toEqual([]);
  });

  it("三职业各有一张「1 费 · 普通 · 保留」格挡牌，且各自挂本职业资源条件", () => {
    const cards = loadGameContent().content.cards;
    // 只数正规牌：衍生物（token，如「铁拳」）也可以带保留，但它们不受「1 费普通」这条画像约束
    const retain = [...cards.values()].filter((c) => (c.keywords ?? []).includes("retain") && !c.token);
    expect(retain.map((c) => c.id).sort()).toEqual(["brace", "coiled_spring", "rust_moss"]);
    for (const c of retain) {
      expect(c.cost, c.id).toBe(1);
      expect(c.rarity, c.id).toBe("common");
      expect(c.type, c.id).toBe("skill");
    }
    // 血械=失控线 / 炉心=充能 / 锈语者=再生（不带条件，rider 是增益本体）
    const conditions = (id: string) =>
      (cards.get(id)!.effects ?? []).map((e) => (e as { condition?: { type: string } }).condition?.type ?? null);
    expect(conditions("brace")).toEqual([null, "hpBelow"]);
    expect(conditions("coiled_spring")).toEqual([null, "chargeAtLeast"]);
    expect(conditions("rust_moss")).toEqual([null, null]);
    // 三张的核心效果两两不同（护栏：它们不能又变成同一张牌）
    const sigs = new Set(retain.map((c) => JSON.stringify([c.effects, c.upgraded?.effects ?? null])));
    expect(sigs.size).toBe(3);
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
