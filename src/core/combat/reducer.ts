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
import { activeTrait, brambleMaxStacks, traitBrambleFromBlock, traitBrambleFromBlockStep, traitCtx, traitLowChargeEnergy, traitTurnStartEffects } from "./trait";
import {
  applyBuffToTarget,
  decayTimedCurses,
  drawCards,
  resolveCorroding,
  resolveCurses,
  resolvePollutionCritical,
  resolveMending,
  resolveEffects,
  pickFromDraw,
  destroyFromHand,
  resolveRegeneration,
  resolveTenacity,
  restoreMaxHp,
  tickAllBuffs,
  tickDelayed,
  tickOverload,
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

/**
 * 玻璃大炮「蓄势」（docs/58 §六.4，甲方 2026-10-07 三次修订）：
 * **每个回合开始**（含战斗第 1 回合）判定一次——充能 <10 时额外 +1 能量，充能攒到 10 即断供。
 * 只加 `energy`（本回合可用），不动 `maxEnergy`；下回合开始再由本函数重判一次。
 */
function grantLowChargeEnergy(draft: Draft): void {
  const bonus = traitLowChargeEnergy(draft);
  if (bonus > 0) draft.player.energy += bonus;
}

/**
 * 特性**回合开始**结算（docs/58 §四，甲方 2026-10-08 修订 · 嗜血满血段）：
 * 现在只有「满血时凭空给一张血契牌」。含战斗第 1 回合。
 * 调用点固定在「本回合手牌就绪之后、揭示意图之前」——额外牌**不占**常规抽牌额度。
 */
function resolveTraitTurnStart(draft: Draft, sink: EventSink): void {
  const effects = traitTurnStartEffects(draft);
  if (effects.length === 0) return;
  resolveEffects(draft, sink, effects, {
    sourceId: `trait:${draft.traitId ?? "none"}`,
    actorId: "player",
    chosenTargetId: null,
  });
}

/** 战斗开始：洗牌、固有词条优先入手、发初始手牌、揭示意图。 */
function startBattle(draft: Draft, sink: EventSink): void {
  draft.turn = 1;
  // 第 1 回合也是一个回合（同 docs/52 §四）：蓄势在开局同样判定，开局充能恒为 0 → 必得 +1。
  grantLowChargeEnergy(draft);
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
  // docs/52 §四（P0）：第 1 回合**也是一个回合**——「回合开始时触发」理应在首回合生效。
  // 原先这条链只在 endTurn 里调，玩家要到第 2 回合才吃得到（红泪戒指首回合不给格挡的实锤 bug）。
  // 时序：洗牌发牌 → 开场状态 → onBattleStart → onTurnStart → 揭示意图 → playerAction。
  resolveTriggers(draft, sink, "onTurnStart");
  // 特性回合开始结算（嗜血满血给牌）：发牌之后就位，不占常规抽牌额度；第 1 回合同样生效。
  resolveTraitTurnStart(draft, sink);
  generateIntents(draft, sink);
  draft.phase = "playerAction";
}

/** 回合结束的手牌关键词结算：保留 / 虚无 / 弃置。 */
function resolveHandAtTurnEnd(draft: Draft, sink: EventSink): void {
  // 祭血狂热「销毁」若玩家还没选（sim / 超时 / UI 未操作），回合结束按手牌顺序自动销毁，
  // 保证 destroyPending 不跨回合泄漏（手牌本就要进弃牌堆，销毁只是改成进消耗堆）。
  while (draft.destroyPending > 0 && draft.hand.length > 0) {
    destroyFromHand(draft, sink, draft.hand[0]!);
  }
  draft.destroyPending = 0;
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
    // 特性胜利结算（docs/58 §七.3 超级大畸变：污染 −50）——放在 BattleEnded 之前，
    // 玩家侧写回的是「已经减过 50」的值。
    const trait = activeTrait(draft);
    if (trait) {
      const effects = trait.handler.onBattleWin?.(trait.def.params, traitCtx(draft)) ?? [];
      if (effects.length > 0) {
        resolveEffects(draft, sink, effects, {
          sourceId: `trait:${trait.def.id}`,
          actorId: "player",
          chosenTargetId: null,
        });
      }
    }
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
  // 特性回合末结算（docs/58 §四 嗜血惩罚 + 奖励）：读的是**本回合**累计造伤 / 自伤
  const trait = activeTrait(draft);
  if (trait) {
    const effects = trait.handler.onTurnEnd?.(trait.def.params, traitCtx(draft)) ?? [];
    if (effects.length > 0) {
      resolveEffects(draft, sink, effects, {
        sourceId: `trait:${trait.def.id}`,
        actorId: "player",
        chosenTargetId: null,
      });
    }
  }
  // 铁皮王八（docs/58 §五，甲方 2026-10-07 三次修订）：回合末把**本回合的格挡**折算成荆棘，
  // 且**每回合刷新**——`next = ⌊本回合格挡 / 8⌋`（上限 10）直接**覆盖**上一回合的层数，不是累加。
  // 「第一回合 10 点格挡 → 得 2 层；第二回合不打格挡 → 第三回合荆棘归零」。
  // 荆棘写成真状态（player.buffs），UI 才有图标；上限通过 maxStacks 覆盖本次施加，不动全局 5 层。
  const brambleStep = traitBrambleFromBlockStep(draft);
  if (brambleStep !== null) {
    const next = Math.min(brambleMaxStacks(draft), traitBrambleFromBlock(draft));
    const current = buffStacks(draft.player.buffs, "bramble");
    if (next !== current) {
      draft.player.buffs = draft.player.buffs.filter((b) => b.id !== "bramble");
      if (current > 0) sink.emit("BuffExpired", { targetId: "player", buffId: "bramble" });
      if (next > 0) {
        applyBuffToTarget(draft, sink, "player", "bramble", next, null, brambleMaxStacks(draft));
      }
    }
  }
  tickAllBuffs(draft, sink, "turnEnd");
  // 冰缓 / 颠倒（层数 = 剩余回合）：在自己回合结束时 −1（docs/46 §3.7/§3.8）
  decayTimedCurses(sink, [draft.player]);
  sink.emit("TurnEnded", { turn: draft.turn });

  draft.phase = "enemyAction";
  // 进入敌方回合即清空"本回合受过伤害"：敌人在此后的攻击会重新置位，
  // 下一玩家回合读到的就是"我刚被打了"（"以血还血"的判定窗口）。
  draft.tookDamageThisTurn = false;
  // 敌人格挡在【敌人自己】的回合开始时清零（docs/03 §4）：
  // 上一回合留下的格挡必须撑过玩家的整个回合，否则防御意图形同虚设。
  for (const enemy of draft.enemies) resolveTenacity(enemy);
  // 蚀锈在【敌方回合开始】结算（甲方 2026-10-07 改版）：先炸一轮再轮到敌人行动。
  // 如果这一下把场上清空了就直接结束战斗——死人不再还手。
  resolveCorroding(draft, sink);
  // 超负荷（docs/58 §六.2）：承载者在**自己回合开始**扣血——敌方侧即此处
  tickOverload(
    draft,
    sink,
    draft.enemies.map((e) => e.id),
  );
  if (checkBattleEnd(draft, sink)) return;
  runEnemyTurn(draft, sink);
  if (checkBattleEnd(draft, sink)) return;
  // 敌人的冰缓 / 颠倒同样在自己的回合结束时递减
  decayTimedCurses(sink, draft.enemies);

  draft.phase = "turnStart";
  draft.turn += 1;
  tickAllBuffs(draft, sink, "turnStart");
  resolveRegeneration(draft, sink);
  resolveMending(draft, sink);
  resolvePollutionCritical(draft, sink);
  // 超负荷（docs/58 §六.2）：承载者在**自己回合开始**扣血——玩家侧即此处
  tickOverload(draft, sink, ["player"]);
  // 诅咒结算（docs/46 §3.7/3.8/3.9）：灼烧扣上限 + 冰缓/颠倒按回合递减
  resolveCurses(draft, sink);
  draft.player.energy = draft.player.maxEnergy;
  // 玻璃大炮「蓄势」（docs/58 §六.4）：新回合开始时再判一次（充能 <10 → +1 能量）
  grantLowChargeEnergy(draft);
  // 只清玩家自己的格挡（坚韧持有时改为置回维续池）；敌人格挡不在此处清（见上方 enemyAction）
  resolveTenacity(draft.player);
  draft.cardsPlayedThisTurn = 0;
  // 敌人「本回合累计承受伤害」（docs/60 §八.3 不屈）：新玩家回合开始归零，
  // 于是它的判定窗口正好是「玩家这一整个回合」。
  for (const enemy of draft.enemies) enemy.damageTakenThisTurn = 0;
  // 特性本回合计数（docs/58 §四/§七）：新回合全量归零
  draft.attackCardsPlayedThisTurn = 0;
  draft.dealtDamageThisTurn = 0;
  draft.selfHpSpentThisTurn = 0;
  draft.eyeUsedThisTurn = false;
  resetTurnRelics(draft);
  resolveTriggers(draft, sink, "onTurnStart");
  sink.emit("TurnStarted", { turn: draft.turn });

  draft.phase = "draw";
  drawCards(draft, sink, Math.max(0, draft.handSize - draft.hand.length));
  // 延迟队列（甲方 2026-10-08）：常规抽牌之后结算到期项（超械铁拳的「铁拳」入手、上发条还充能）。
  tickDelayed(draft, sink);
  // 特性回合开始结算（嗜血满血给牌）：常规抽牌之后再给，所以是真·「额外」一张。
  resolveTraitTurnStart(draft, sink);

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
    case "PickFromDraw":
      // 神眼（docs/58 §七.2）：每回合一次，从牌库任选一张入手
      if (draft.phase === "playerAction") pickFromDraw(draft, sink, action.instanceId);
      break;
    case "DestroyFromHand":
      // 祭血狂热（甲方 2026-10-08）：兑现「销毁一张手牌」的待选
      if (draft.phase === "playerAction") destroyFromHand(draft, sink, action.instanceId);
      break;
    case "DebugCommand": {
      // 回执进事件流，控制台才有反馈（以前返回值被丢掉，按了「执行」看不出成功没成功）
      const result = executeDebugCommand(draft, sink, action.command);
      sink.emit("DebugMessage", { ok: result.ok, message: result.message });
      break;
    }
    case "Noop":
      break;
    default:
      break;
  }

  checkBattleEnd(draft, sink);
  return { state: fromDraft(draft, sink.nextSeq), events: sink.list() };
}

