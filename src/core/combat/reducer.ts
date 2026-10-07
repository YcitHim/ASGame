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
import { buffStacks, hasBuff } from "../buffs";
import { isInnate, turnEndDestination } from "../keywords";
import { executeDebugCommand } from "./debug";
import { definitionOf, fromDraft, livingEnemies, toDraft, type Draft } from "./draft";
import { generateIntents, runEnemyTurn } from "./enemy-turn";
import { effectiveCard, playCard } from "./play-card";
import { resetTurnRelics, resolveTriggers } from "./relics";
import {
  applyBuffToTarget,
  drawCards,
  resolveCurses,
  resolvePollutionCritical,
  resolveMending,
  resolveRegeneration,
  resolveTenacity,
  restoreMaxHp,
  tickAllBuffs,
} from "./resolve";
import type { BattleState } from "./state";

export interface ReduceResult {
  readonly state: BattleState;
  readonly events: readonly DomainEvent[];
}

/**
 * 颠倒（docs/46 §3.8）：回合开始把手牌费用重掷为 0~3（同回合内稳定，UI 与结算同源）。
 * 随机走独立的 curse 流，不污染 combat 流；没有颠倒时清空。
 */
function rollReverseCosts(draft: Draft): void {
  if (buffStacks(draft.player.buffs, "reverse") <= 0) {
    draft.reverseCosts = {};
    return;
  }
  const rng = draft.rng.stream("curse");
  const costs: Record<string, number> = {};
  for (const instanceId of draft.hand) costs[instanceId] = rng.nextInt(0, 3);
  draft.reverseCosts = costs;
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

  rollReverseCosts(draft);
  // 开场状态（docs/47 §三.4）：战斗开始即挂在敌人自己身上
  for (const enemy of draft.enemies) {
    const def = draft.content.enemies.get(enemy.defId);
    for (const sb of def?.startBuffs ?? []) {
      applyBuffToTarget(draft, sink, enemy.id, sb.buffId, sb.stacks);
    }
  }
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
    restoreMaxHp(draft);
    sink.emit("BattleEnded", { result: "lose", rewardsSeed: 0 });
    return true;
  }
  if (livingEnemies(draft).length === 0) {
    draft.phase = "battleEnd";
    // 灼烧的减上限只在本场生效（docs/46 §3.9）：结算前恢复，已损失的 HP 不补
    restoreMaxHp(draft);
    const rewardsSeed = draft.rng.stream("reward").nextInt(0, 0xffffffff);
    sink.emit("BattleEnded", { result: "win", rewardsSeed });
    return true;
  }
  return false;
}

/** 结束回合 → 敌人行动 → 下一回合 turnStart → 抽牌 → 揭示意图。 */
function endTurn(draft: Draft, sink: EventSink): void {
  draft.phase = "turnEnd";
  // 眩晕（docs/46 §3.5）：被跳过的那一回合结束即消耗掉（施加发生在敌方回合内，
  // 所以必须在敌方回合之前清，否则刚挂上的眩晕会被同一次 endTurn 吃掉）
  if (hasBuff(draft.player.buffs, "stun")) {
    draft.player.buffs = draft.player.buffs.filter((b) => b.id !== "stun");
    sink.emit("BuffExpired", { targetId: "player", buffId: "stun" });
  }
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
  for (const enemy of draft.enemies) resolveTenacity(enemy);
  runEnemyTurn(draft, sink);
  if (checkBattleEnd(draft, sink)) return;

  draft.phase = "turnStart";
  draft.turn += 1;
  tickAllBuffs(draft, sink, "turnStart");
  resolveRegeneration(draft, sink);
  resolveMending(draft, sink);
  resolvePollutionCritical(draft, sink);
  // 诅咒结算（docs/46 §3.7/3.8/3.9）：灼烧扣上限 + 冰缓/颠倒按回合递减
  resolveCurses(draft, sink);
  draft.player.energy = draft.player.maxEnergy;
  // 只清玩家自己的格挡（坚韧持有时改为置回维续池）；敌人格挡不在此处清（见上方 enemyAction）
  resolveTenacity(draft.player);
  draft.cardsPlayedThisTurn = 0;
  resetTurnRelics(draft);
  resolveTriggers(draft, sink, "onTurnStart");
  sink.emit("TurnStarted", { turn: draft.turn });

  draft.phase = "draw";
  drawCards(draft, sink, Math.max(0, draft.handSize - draft.hand.length));

  draft.phase = "playerAction";
  rollReverseCosts(draft);
  generateIntents(draft, sink);
}

export function reduce(state: BattleState, action: Action): ReduceResult {
  const sink = new EventSink(state.eventSeq, action.actionId);
  const draft = toDraft(state);

  if (draft.phase === "battleStart") startBattle(draft, sink);

  switch (action.type) {
    case "PlayCard":
      // 眩晕（docs/46 §3.5）：玩家被眩晕的整回合不可出牌，但可以结束回合
      if (draft.phase === "playerAction" && !hasBuff(draft.player.buffs, "stun")) {
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

