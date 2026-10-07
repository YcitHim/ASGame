/**
 * headless-sim · 录制 golden replay（S6.2）
 *
 * 用确定性 AI 驱动一场战斗，把「初始配置 + 输入流 + 事件流哈希」落盘。
 * CI 重放时只喂输入流，断言事件流哈希完全一致——重构的照妖镜。
 */
import { createHash } from "node:crypto";
import type { Action } from "../../../src/core/actions";
import type { DomainEvent } from "../../../src/core/events";
import { createBattleState, reduce } from "../../../src/core/combat";
import type { ContentDb } from "../../../src/core/registry";
import { choosePlay, chooseTarget } from "./ai";

export interface GoldenDeckEntry {
  cardId: string;
  upgraded: boolean;
  enhancements: string[];
}

export interface GoldenBattle {
  id: string;
  nodeId: string;
  enemies: string[];
  deck: GoldenDeckEntry[];
  relics: string[];
  seed: number;
  player: { maxHp: number; energy: number };
  /** 职业特性（docs/58 §二）：缺省空串 = 无特性（老基线盘不受影响） */
  traitId?: string;
  /** 开局污染（docs/58 §七.2 畸变阈值快照用） */
  pollution?: number;
  actions: Action[];
  /** 事件流哈希（重放必须一致） */
  eventHash: string;
  /** 供人看的事件类型序列（截断） */
  eventTypes: string[];
  turns: number;
  outcome: "win" | "lose" | "open";
}

export interface GoldenFile {
  version: 1;
  recordedAt: string;
  content: "rust-and-blood";
  battle: GoldenBattle;
}

export function hashEvents(events: readonly DomainEvent[]): string {
  return createHash("sha256").update(JSON.stringify(events)).digest("hex");
}

export interface RecordBattleArgs {
  content: ContentDb;
  /** 文件 id（如 golden-n1） */
  id: string;
  nodeId: string;
  enemies: readonly string[];
  deck: readonly GoldenDeckEntry[];
  relics: readonly string[];
  seed: number;
  maxHp?: number;
  energy?: number;
  /** 职业特性（docs/58 §二）：缺省 = 无特性 */
  traitId?: string;
  /** 开局污染（docs/58 §七.2） */
  pollution?: number;
}

export function recordBattle(args: RecordBattleArgs): GoldenBattle {
  const maxHp = args.maxHp ?? 66;
  const energy = args.energy ?? 3;
  const traitId = args.traitId ?? "";
  const pollution = args.pollution ?? 0;

  const start: Action = { type: "Noop", actionId: "start" };
  let state = createBattleState({
    battleId: args.id,
    seed: args.seed,
    player: { maxHp, energy, pollution },
    enemies: args.enemies.map((id) => ({ id })),
    deck: args.deck.map((c) => ({ cardId: c.cardId, upgraded: c.upgraded, enhancements: c.enhancements })),
    handSize: 5,
    relics: [...args.relics],
    content: args.content,
    traitId,
  });

  const actions: Action[] = [start];
  const events: DomainEvent[] = [];
  const first = reduce(state, start);
  state = first.state;
  events.push(...first.events);

  let guard = 0;
  while (state.phase !== "battleEnd" && guard < 800) {
    guard += 1;
    const target = chooseTarget(state) ?? null;
    const index = choosePlay(state, args.content, target);
    const action: Action =
      index === null
        ? { type: "EndTurn", actionId: `e${guard}` }
        : { type: "PlayCard", actionId: `p${guard}`, handIndex: index, ...(target ? { targetId: target } : {}) };
    const result = reduce(state, action);
    state = result.state;
    actions.push(action);
    events.push(...result.events);
  }

  const outcome: GoldenBattle["outcome"] =
    state.phase !== "battleEnd" ? "open" : state.player.hp > 0 ? "win" : "lose";

  return {
    id: args.id,
    nodeId: args.nodeId,
    enemies: [...args.enemies],
    deck: args.deck.map((c) => ({ ...c, enhancements: [...c.enhancements] })),
    relics: [...args.relics],
    seed: args.seed,
    player: { maxHp, energy },
    ...(traitId ? { traitId } : {}),
    ...(pollution > 0 ? { pollution } : {}),
    actions,
    eventHash: hashEvents(events),
    eventTypes: events.map((e) => e.type).slice(0, 40),
    turns: state.turn,
    outcome,
  };
}

/** 重放：只喂输入流，返回事件流哈希与结算信息。 */
export function replayBattle(file: GoldenFile, content: ContentDb): { hash: string; turns: number; outcome: GoldenBattle["outcome"] } {
  const b = file.battle;
  let state = createBattleState({
    battleId: b.id,
    seed: b.seed,
    player: { ...b.player, pollution: b.pollution ?? 0 },
    enemies: b.enemies.map((id) => ({ id })),
    deck: b.deck.map((c) => ({ cardId: c.cardId, upgraded: c.upgraded, enhancements: c.enhancements })),
    handSize: 5,
    relics: b.relics,
    content,
    traitId: b.traitId ?? "",
  });
  const events: DomainEvent[] = [];
  for (const action of b.actions) {
    const result = reduce(state, action);
    state = result.state;
    events.push(...result.events);
  }
  const outcome: GoldenBattle["outcome"] =
    state.phase !== "battleEnd" ? "open" : state.player.hp > 0 ? "win" : "lose";
  return { hash: hashEvents(events), turns: state.turn, outcome };
}
