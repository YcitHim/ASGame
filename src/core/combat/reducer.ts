/**
 * core/combat · reduce 主循环入口： (state, action) → { state', events[] }
 *
 * 纯函数：同样的 (state, action) 永远产出同样的 (state', events)。
 * 随机只从 core/rng 的分源流取；状态不可变。
 *
 * S2 范围：battleStart → turnStart → draw → playerAction 空转；
 * 出牌判定、敌人行动在 S3 接入（本文件保持骨架清晰，不塞半成品）。
 */
import type { Action } from "../actions";
import { tickBuffs, type BuffInstance } from "../buffs";
import type { DomainEvent } from "../events";
import { EventSink } from "../events";
import { Rng } from "../rng";
import type { BattleState } from "./state";

export interface ReduceResult {
  readonly state: BattleState;
  readonly events: readonly DomainEvent[];
}

/** 洗牌需要的流；同一 reduce 内复用同一 Rng 实例，结束时快照回状态。 */
function combatRng(state: BattleState): Rng {
  return Rng.fromSnapshot(state.rootSeed, state.rng);
}

function tickAllBuffs(
  state: BattleState,
  sink: EventSink,
): { player: readonly BuffInstance[]; enemies: BattleState["enemies"] } {
  const playerTick = tickBuffs(state.player.buffs, "turnStart");
  for (const b of playerTick.expired) sink.emit("BuffExpired", { targetId: "player", buffId: b.id });

  const enemies = state.enemies.map((e) => {
    const tick = tickBuffs(e.buffs, "turnStart");
    for (const b of tick.expired) sink.emit("BuffExpired", { targetId: e.id, buffId: b.id });
    return { ...e, buffs: tick.buffs };
  });

  return { player: playerTick.buffs, enemies };
}

/** 从抽牌堆抽 count 张；堆空则把弃牌堆洗入（发 DeckShuffled）。 */
function drawCards(
  state: BattleState,
  rng: Rng,
  count: number,
  sink: EventSink,
): { draw: readonly string[]; discard: readonly string[]; hand: readonly string[]; drawn: readonly string[] } {
  let draw = state.piles.draw.slice();
  let discard = state.piles.discard.slice();
  const hand = state.piles.hand.slice();
  const drawn: string[] = [];

  for (let i = 0; i < count; i += 1) {
    if (draw.length === 0) {
      if (discard.length === 0) break;
      draw = rng.stream("combat").shuffle(discard);
      sink.emit("DeckShuffled", { from: "discard", count: draw.length });
      discard = [];
    }
    const card = draw.shift();
    if (card === undefined) break;
    hand.push(card);
    drawn.push(card);
  }

  return { draw, discard, hand, drawn };
}

/** 战斗开始：洗牌、发初始手牌、发 BattleStarted，进入玩家行动。 */
function startBattle(state: BattleState, sink: EventSink): BattleState {
  const rng = combatRng(state);
  const offered: readonly string[] = rng.stream("combat").shuffle(state.piles.draw);

  const base: BattleState = {
    ...state,
    turn: 1,
    piles: { ...state.piles, draw: offered, hand: [], discard: [] },
    rng: rng.snapshot(),
    phase: "playerAction",
  };

  // BattleStarted 先行：起始手牌 = 洗牌后的前 handSize 张（与随后 drawCards 结果一致）。
  sink.emit("BattleStarted", {
    enemies: state.enemies.map((e) => ({ id: e.id, maxHp: e.maxHp })),
    startingHand: offered.slice(0, base.handSize),
    turn: base.turn,
  });

  const drawn = drawCards(base, rng, base.handSize, sink);
  sink.emit("CardsDrawn", { cardIds: drawn.drawn });

  return {
    ...base,
    piles: { ...base.piles, draw: drawn.draw, hand: drawn.hand, discard: drawn.discard },
    rng: rng.snapshot(),
  };
}

/** 结束回合 → 敌人行动（S2 无敌人行动）→ turnEnd → 下一回合 turnStart + 抽牌。 */
function endTurn(state: BattleState, sink: EventSink): BattleState {
  const rng = combatRng(state);
  sink.emit("TurnEnded", { turn: state.turn });

  // 回合结束：手牌进入弃牌堆（保留/虚无等关键词由 S3 接管）
  const discarded = [...state.piles.discard, ...state.piles.hand];
  const ticked = tickAllBuffs({ ...state, turn: state.turn + 1 }, sink);

  // 回合开始：能量重置、格挡清零（docs/03 §3 第 3 步，已拍板）
  const started: BattleState = {
    ...state,
    turn: state.turn + 1,
    phase: "playerAction",
    player: {
      ...state.player,
      energy: state.player.maxEnergy,
      block: 0,
      buffs: ticked.player,
    },
    enemies: ticked.enemies.map((e) => ({ ...e, block: 0 })),
    piles: { ...state.piles, hand: [], discard: discarded },
  };
  sink.emit("TurnStarted", { turn: started.turn });

  const drawn = drawCards(started, rng, started.handSize, sink);
  sink.emit("CardsDrawn", { cardIds: drawn.drawn });

  return {
    ...started,
    piles: { ...started.piles, draw: drawn.draw, discard: drawn.discard, hand: drawn.hand },
    rng: rng.snapshot(),
  };
}

export function reduce(state: BattleState, action: Action): ReduceResult {
  const sink = new EventSink(state.eventSeq, action.actionId);
  let next = state;

  if (next.phase === "battleStart") {
    next = startBattle(next, sink);
  }

  switch (action.type) {
    case "EndTurn":
      if (next.phase === "playerAction") next = endTurn(next, sink);
      break;
    case "Noop":
    case "DebugCommand":
      // 空转演示 / S3 接入调试指令
      break;
    default:
      // PlayCard / 地图与奖励类 Action 在 S3 起逐步接入
      break;
  }

  return { state: { ...next, eventSeq: sink.nextSeq }, events: sink.list() };
}
