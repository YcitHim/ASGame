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
  rollEnhancementChoices,
  setRunHp,
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
}

export interface BattleRunConfig {
  battleId: string;
  seed: number;
  maxHp: number;
  energy: number;
  hp: number;
  enemies: readonly string[];
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
    player: { maxHp: config.maxHp, energy: config.energy, hp: config.hp },
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
        enemies: node.enemies ?? [],
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
      if (battle.state.phase !== "battleEnd" || battle.state.player.hp <= 0) return finish("lose");

      if (node.kind === "elite") hpAfterElite = battle.state.player.hp;
      if (node.kind === "boss") hpAfterBoss = battle.state.player.hp;

      // 战后卡奖
      const rewards = rollCardRewards(content, act, run, run.nodeIndex);
      const pick = bestReward(rewards, content);
      if (pick) {
        deck.push({ cardId: pick, upgraded: false, enhancements: [] });
        cardsPicked[pick] = (cardsPicked[pick] ?? 0) + 1;
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

    if (node.kind === "altar") {
      const choices = rollEnhancementChoices(content, run, run.nodeIndex);
      for (const id of choices) {
        const enhancement = content.enhancements.get(id);
        if (!enhancement) continue;
        // 与游戏规则一致：同一强化全局唯一
        const alreadyOwned = deck.some((c) => c.enhancements.includes(id));
        const target = alreadyOwned
          ? -1
          : deck.findIndex(
              (c) =>
                enhancement.appliesTo.includes(c.cardId) &&
                c.enhancements.length < MAX_ENHANCEMENT_SLOTS,
            );
        if (target >= 0) {
          deck[target] = { ...deck[target], enhancements: [...deck[target].enhancements, id] };
          enhancements[id] = (enhancements[id] ?? 0) + 1;
          break;
        }
      }
      run = advanceNode(run, act);
      continue;
    }

    run = advanceNode(run, act);
  }

  return finish("win");
}
