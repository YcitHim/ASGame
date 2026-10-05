/**
 * core/combat · reduce 主循环入口： (state, action) → { state', events[] }
 *
 * 纯函数：同样的 (state, action) 永远产出同样的 (state', events)。
 * 相位流转（docs/02 §4）：
 *   battleStart → [turnStart → draw → playerAction → enemyAction → turnEnd] × N → battleEnd
 * 内部用 Draft 工作副本结算，输入 state 绝不被修改。
 */
import type { Action } from "../actions";
import type { DomainEvent } from "../events";
import { EventSink } from "../events";
import { isInnate, turnEndDestination } from "../keywords";
import { executeDebugCommand } from "./debug";
import { definitionOf, fromDraft, livingEnemies, toDraft, type Draft } from "./draft";
import { generateIntents, runEnemyTurn } from "./enemy-turn";
import { effectiveCard, playCard } from "./play-card";
import { resetTurnRelics, resolveTriggers } from "./relics";
import {
  drawCards,
  resolvePollutionCritical,
  resolveRegeneration,
  tickAllBuffs,
} from "./resolve";
import type { BattleState } from "./state";

export interface ReduceResult {
  readonly state: BattleState;
  readonly events: readonly DomainEvent[];
}

/** 战斗开始：洗牌、固有词条优先入手、发初始手牌、揭示意图。 */
function startBattle(draft: Draft, sink: EventSink): void {
  draft.turn = 1;
  const shuffled = draft.rng.stream("combat").shuffle(draft.draw);
  const innate: string[] = [];
  const rest: string[] = [];
  for (const id of shuffled) {
    const def = definitionOf(draft, id);
    const instance = draft.cardInstances[id];
    const keywords = def && instance ? effectiveCard(def, instance).keywords : [];
    if (isInnate({ keywords })) innate.push(id);
    else rest.push(id);
  }
  const hand = [...innate, ...rest].slice(0, draft.handSize);
  const handSet = new Set(hand);
  draft.hand = hand;
  draft.draw = shuffled.filter((id) => !handSet.has(id));

  sink.emit("BattleStarted", {
    enemies: draft.enemies.map((e) => ({ id: e.id, maxHp: e.maxHp })),
    startingHand: hand,
    turn: draft.turn,
  });
  sink.emit("CardsDrawn", { cardIds: hand });

  resolveTriggers(draft, sink, "onBattleStart");
  generateIntents(draft, sink);
  draft.phase = "playerAction";
}

/** 回合结束的手牌关键词结算：保留 / 虚无 / 弃置。 */
function resolveHandAtTurnEnd(draft: Draft, sink: EventSink): void {
  const retained: string[] = [];
  for (const instanceId of draft.hand) {
    const def = definitionOf(draft, instanceId);
    const instance = draft.cardInstances[instanceId];
    if (!def || !instance) {
      draft.discard.push(instanceId);
      continue;
    }
    const eff = effectiveCard(def, instance);
    const destination = turnEndDestination({ keywords: eff.keywords, bloodCost: eff.bloodCost });
    if (destination === "retain") {
      retained.push(instanceId);
      sink.emit("CardRetained", { cardId: instance.cardId });
    } else if (destination === "exhaust") {
      draft.exhaust.push(instanceId);
      sink.emit("CardExhausted", { cardId: instance.cardId });
    } else {
      draft.discard.push(instanceId);
    }
  }
  draft.hand = retained;
}

function checkBattleEnd(draft: Draft, sink: EventSink): boolean {
  if (draft.phase === "battleEnd") return true;
  if (draft.player.hp <= 0) {
    draft.phase = "battleEnd";
    sink.emit("BattleEnded", { result: "lose", rewardsSeed: 0 });
    return true;
  }
  if (livingEnemies(draft).length === 0) {
    draft.phase = "battleEnd";
    const rewardsSeed = draft.rng.stream("reward").nextInt(0, 0xffffffff);
    sink.emit("BattleEnded", { result: "win", rewardsSeed });
    return true;
  }
  return false;
}

/** 结束回合 → 敌人行动 → 下一回合 turnStart → 抽牌 → 揭示意图。 */
function endTurn(draft: Draft, sink: EventSink): void {
  draft.phase = "turnEnd";
  resolveHandAtTurnEnd(draft, sink);
  resolveTriggers(draft, sink, "onTurnEnd");
  tickAllBuffs(draft, sink, "turnEnd");
  sink.emit("TurnEnded", { turn: draft.turn });

  draft.phase = "enemyAction";
  // 进入敌方回合即清空"本回合受过伤害"：敌人在此后的攻击会重新置位，
  // 下一玩家回合读到的就是"我刚被打了"（"以血还血"的判定窗口）。
  draft.tookDamageThisTurn = false;
  // 敌人格挡在【敌人自己】的回合开始时清零（docs/03 §4）：
  // 上一回合留下的格挡必须撑过玩家的整个回合，否则防御意图形同虚设。
  for (const enemy of draft.enemies) enemy.block = 0;
  runEnemyTurn(draft, sink);
  if (checkBattleEnd(draft, sink)) return;

  draft.phase = "turnStart";
  draft.turn += 1;
  tickAllBuffs(draft, sink, "turnStart");
  resolveRegeneration(draft, sink);
  resolvePollutionCritical(draft, sink);
  draft.player.energy = draft.player.maxEnergy;
  // 只清玩家自己的格挡；敌人格挡不在此处清（见上方 enemyAction）
  draft.player.block = 0;
  draft.cardsPlayedThisTurn = 0;
  resetTurnRelics(draft);
  resolveTriggers(draft, sink, "onTurnStart");
  sink.emit("TurnStarted", { turn: draft.turn });

  draft.phase = "draw";
  drawCards(draft, sink, Math.max(0, draft.handSize - draft.hand.length));

  draft.phase = "playerAction";
  generateIntents(draft, sink);
}

export function reduce(state: BattleState, action: Action): ReduceResult {
  const sink = new EventSink(state.eventSeq, action.actionId);
  const draft = toDraft(state);

  if (draft.phase === "battleStart") startBattle(draft, sink);

  switch (action.type) {
    case "PlayCard":
      if (draft.phase === "playerAction") {
        playCard(draft, sink, action.handIndex, action.targetId ?? null);
      }
      break;
    case "EndTurn":
      if (draft.phase === "playerAction") endTurn(draft, sink);
      break;
    case "DebugCommand":
      executeDebugCommand(draft, sink, action.command);
      break;
    case "Noop":
      break;
    default:
      break;
  }

  checkBattleEnd(draft, sink);
  return { state: fromDraft(draft, sink.nextSeq), events: sink.list() };
}

