/**
 * headless-sim · 单局模拟（线性地图 → 战斗 → 奖励 / 休息 / 祭坛 → ... → Boss）
 */
import type { Action } from "../../../src/core/actions";
import type { DomainEvent } from "../../../src/core/events";
import { createBattleState, reduce, type BattleState } from "../../../src/core/combat";
import {
  advanceNode,
  createRunState,
  currentNode,
  healRun,
  isCombatNode,
  isRunComplete,
  MAX_ENHANCEMENT_SLOTS,
  rollCardRewards,
  rollEncounter,
  rollEnhancementChoices,
  rollEvent,
  rollRelicChoices,
  resolveEventOption,
  setRunHp,
  setRunPollution,
  type RunState,
} from "../../../src/core/map";
import type { ActDefinition, ContentDb } from "../../../src/core/registry";
import { cardValue, choosePlay, chooseTarget } from "./ai";

export interface SimCard {
  cardId: string;
  upgraded: boolean;
  enhancements: string[];
}

export interface SimResult {
  seed: number;
  outcome: "win" | "lose";
  nodeReached: number;
  battles: number;
  turns: number;
  damageDealt: number;
  damageTaken: number;
  cardsPlayed: Record<string, number>;
  cardsPicked: Record<string, number>;
  enhancements: Record<string, number>;
  /** 通过精英战后的剩余 HP（docs/19 §3：可触发的精英验收指标） */
  hpAfterElite: number | null;
  /** 通过 Boss 战后的剩余 HP */
  hpAfterBoss: number | null;
  /** 本局是否组出「失控线爆发流」（同一张牌同时有 血怒 + 低血沸腾，docs/23 §10 口径 b） */
  bloodrageBoil: boolean;
  /** 本局是否同时持有 血怒 与 低血沸腾（可不同卡）——诊断 AI 会不会凑对（docs/25 §1.6） */
  bloodrageBoilAny: boolean;
}

export interface BattleRunConfig {
  battleId: string;
  seed: number;
  maxHp: number;
  energy: number;
  hp: number;
  enemies: readonly string[];
  pollution?: number;
  deck: readonly SimCard[];
  relics: readonly string[];
}

export interface BattleRunOutcome {
  state: BattleState;
  turns: number;
  damageDealt: number;
  damageTaken: number;
  cardsPlayed: Record<string, number>;
}

const MAX_BATTLE_ACTIONS = 600;

/**
 * 取一枚可附着的强化并附着到第一张"可附着目标"（祭坛 / 精英残骸共用，docs/25 §1.3）。
 * 目标允许是已经附着过强化的牌（只要还有槽）——**同卡双挂必须可行**，这是 docs/25 决策的全部意义。
 */
function applyEnhancementChoice(
  content: ContentDb,
  deck: SimCard[],
  choices: readonly string[],
): string | null {
  for (const id of choices) {
    const enhancement = content.enhancements.get(id);
    if (!enhancement) continue;
    if (deck.some((c) => c.enhancements.includes(id))) continue;
    const target = deck.findIndex(
      (c) =>
        enhancement.appliesTo.includes(c.cardId) &&
        c.enhancements.length < MAX_ENHANCEMENT_SLOTS,
    );
    if (target >= 0) {
      deck[target] = { ...deck[target], enhancements: [...deck[target].enhancements, id] };
      return id;
    }
  }
  return null;
}

/** 事件选项评分（贪心 AI）：优先强化/遗物/卡，HP 越低越避忌付费；赌博按期望值。 */
function chooseEventOption(
  def: import("../../../src/core/registry").EventDefinition,
  run: RunState,
  act: ActDefinition,
): string {
  const hpRatio = run.hp / Math.max(1, act.player.maxHp);
  const scoreEffect = (kind: string, value: number, count = 1): number => {
    switch (kind) {
      case "gainEnhancement":
        return 30;
      case "gainRelic":
        return 22;
      case "gainCard":
        return 8 * count;
      case "hp":
        return value * (value < 0 ? (hpRatio < 0.4 ? 0.45 : 0.9) : 0.15);
      case "pollution":
        return -value * (value > 0 ? 0.25 : 0.18);
      default:
        return 0;
    }
  };
  let best = def.options[0]?.id ?? "a";
  let bestScore = -Infinity;
  for (const opt of def.options) {
    let score = (opt.effects ?? []).reduce((s, e) => s + scoreEffect(e.kind, e.value ?? 0, e.count ?? 1), 0);
    const outcomes = opt.outcomes ?? [];
    if (outcomes.length > 0) {
      const total = outcomes.reduce((s, o) => s + o.weight, 0) || 1;
      score += outcomes.reduce(
        (s, o) => s + (o.weight / total) * o.effects.reduce((t, e) => t + scoreEffect(e.kind, e.value ?? 0, e.count ?? 1), 0),
        0,
      );
    }
    if (score > bestScore) {
      bestScore = score;
      best = opt.id;
    }
  }
  return best;
}

export function bestReward(ids: readonly string[], content: ContentDb): string | null {
  let best: { id: string; value: number } | null = null;
  for (const id of ids) {
    const def = content.cards.get(id);
    if (!def) continue;
    const value = cardValue(def);
    if (!best || value > best.value) best = { id, value };
  }
  return best?.id ?? null;
}

/** 跑完一整场战斗，返回终局状态与统计（主线与场景直开共用）。 */
export function runBattle(content: ContentDb, config: BattleRunConfig): BattleRunOutcome {
  let state: BattleState = createBattleState({
    battleId: config.battleId,
    seed: config.seed,
    player: { maxHp: config.maxHp, energy: config.energy, hp: config.hp, pollution: config.pollution ?? 0 },
    enemies: config.enemies.map((id) => ({ id })),
    deck: config.deck.map((c) => ({ cardId: c.cardId, upgraded: c.upgraded, enhancements: c.enhancements })),
    relics: [...config.relics],
    content,
  });
  state = reduce(state, { type: "Noop", actionId: "s" }).state;

  let damageDealt = 0;
  let damageTaken = 0;
  const cardsPlayed: Record<string, number> = {};
  let guard = 0;

  while (state.phase !== "battleEnd" && guard < MAX_BATTLE_ACTIONS) {
    guard += 1;
    const target = chooseTarget(state) ?? null;
    const playIndex = choosePlay(state, content, target);
    const action: Action =
      playIndex === null
        ? { type: "EndTurn", actionId: `e${guard}` }
        : {
            type: "PlayCard",
            actionId: `p${guard}`,
            handIndex: playIndex,
            ...(target ? { targetId: target } : {}),
          };
    const result = reduce(state, action);
    state = result.state;
    for (const event of result.events as readonly DomainEvent[]) {
      if (event.type === "DamageDealt") {
        if (event.targetId === "player") damageTaken += event.hpLost;
        else damageDealt += event.hpLost;
      } else if (event.type === "CardPlayed") {
        cardsPlayed[event.cardId] = (cardsPlayed[event.cardId] ?? 0) + 1;
      }
    }
  }

  return { state, turns: state.turn, damageDealt, damageTaken, cardsPlayed };
}

export function simulateRun(content: ContentDb, act: ActDefinition, seed: number): SimResult {
  let run = createRunState(act, seed);
  const deck: SimCard[] = act.startDeck.map((cardId) => ({ cardId, upgraded: false, enhancements: [] }));
  const relics = [...(act.startRelics ?? [])];

  const cardsPlayed: Record<string, number> = {};
  const cardsPicked: Record<string, number> = {};
  const enhancements: Record<string, number> = {};
  let turns = 0;
  let damageDealt = 0;
  let damageTaken = 0;
  let battles = 0;
  let hpAfterElite: number | null = null;
  let hpAfterBoss: number | null = null;

  const finish = (outcome: "win" | "lose"): SimResult => ({
    seed,
    outcome,
    nodeReached: run.nodeIndex,
    battles,
    turns,
    damageDealt,
    damageTaken,
    cardsPlayed,
    cardsPicked,
    enhancements,
    hpAfterElite,
    hpAfterBoss,
    bloodrageBoil: deck.some(
      (c) => c.enhancements.includes("bloodrage") && c.enhancements.includes("bloodboil"),
    ),
    bloodrageBoilAny:
      deck.some((c) => c.enhancements.includes("bloodrage")) &&
      deck.some((c) => c.enhancements.includes("bloodboil")),
  });

  while (!isRunComplete(run, act)) {
    const node = currentNode(run, act);
    if (!node) break;

    if (isCombatNode(node)) {
      battles += 1;
      const battle = runBattle(content, {
        battleId: `${act.id}-${node.id}`,
        seed: (run.seed ^ Math.imul(run.nodeIndex + 1, 0x9e3779b9)) >>> 0,
        maxHp: act.player.maxHp,
        energy: act.player.energy,
        hp: run.hp,
        pollution: run.pollution,
        enemies: rollEncounter(run, node),
        deck,
        relics,
      });

      turns += battle.turns;
      damageDealt += battle.damageDealt;
      damageTaken += battle.damageTaken;
      for (const [id, n] of Object.entries(battle.cardsPlayed)) {
        cardsPlayed[id] = (cardsPlayed[id] ?? 0) + n;
      }

      run = setRunHp(run, battle.state.player.hp);
      run = setRunPollution(run, battle.state.player.pollution);
      if (battle.state.phase !== "battleEnd" || battle.state.player.hp <= 0) return finish("lose");

      if (node.kind === "elite") hpAfterElite = battle.state.player.hp;
      if (node.kind === "boss") hpAfterBoss = battle.state.player.hp;

      // 战后奖励（对齐游戏真实流程）：
      //   普通战 = 卡奖；精英 = 遗物 + 强化三选一（docs/25 §1，无卡奖）；Boss = 结束
      if (node.kind === "battle") {
        const rewards = rollCardRewards(content, act, run, run.nodeIndex);
        const pick = bestReward(rewards, content);
        if (pick) {
          deck.push({ cardId: pick, upgraded: false, enhancements: [] });
          cardsPicked[pick] = (cardsPicked[pick] ?? 0) + 1;
        }
      } else if (node.kind === "elite") {
        const relic = rollRelicChoices(content, relics, 1)[0];
        if (relic && !relics.includes(relic)) relics.push(relic);
        const applied = applyEnhancementChoice(
          content,
          deck,
          rollEnhancementChoices(content, run, run.nodeIndex),
        );
        if (applied) enhancements[applied] = (enhancements[applied] ?? 0) + 1;
      }
      run = advanceNode(run, act);
      continue;
    }

    if (node.kind === "rest") {
      if (run.hp < act.player.maxHp * 0.7) {
        run = healRun(run, act.player.maxHp, Math.round(act.player.maxHp * 0.3));
      } else {
        const index = deck.findIndex((c) => !c.upgraded);
        if (index >= 0) deck[index] = { ...deck[index], upgraded: true };
      }
      run = advanceNode(run, act);
      continue;
    }

    if (node.kind === "event") {
      const def = rollEvent(content, run, node);
      if (def) {
        const optionId = chooseEventOption(def, run, act);
        const seed = (run.seed ^ Math.imul(run.nodeIndex + 11, 0x27d4eb2f)) >>> 0;
        const res = resolveEventOption(content, def, optionId, { seed, ownedRelics: relics });
        if (res) {
          if (res.hpDelta !== 0) {
            run = setRunHp(run, Math.max(1, Math.min(act.player.maxHp, run.hp + res.hpDelta)));
          }
          if (res.pollutionDelta !== 0) run = setRunPollution(run, run.pollution + res.pollutionDelta);
          for (const id of res.relicIds) if (!relics.includes(id)) relics.push(id);
          for (const id of res.cardIds) deck.push({ cardId: id, upgraded: false, enhancements: [] });
          if (res.gainEnhancement) {
            const applied = applyEnhancementChoice(content, deck, rollEnhancementChoices(content, run, run.nodeIndex));
            if (applied) enhancements[applied] = (enhancements[applied] ?? 0) + 1;
          }
        }
      }
      run = advanceNode(run, act);
      continue;
    }

    if (node.kind === "altar") {
      const applied = applyEnhancementChoice(
        content,
        deck,
        rollEnhancementChoices(content, run, run.nodeIndex),
      );
      if (applied) enhancements[applied] = (enhancements[applied] ?? 0) + 1;
      run = advanceNode(run, act);
      continue;
    }

    run = advanceNode(run, act);
  }

  return finish("win");
}