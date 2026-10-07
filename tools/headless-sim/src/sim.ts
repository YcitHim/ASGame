/**
 * headless-sim · 单局模拟（线性地图 → 战斗 → 奖励 / 休息 / 祭坛 → ... → Boss）
 */
import type { Action } from "../../../src/core/actions";
import type { DomainEvent } from "../../../src/core/events";
import { createBattleState, eyeAvailable, reduce, type BattleState } from "../../../src/core/combat";
import {
  advanceNode,
  chooseNode,
  createRunState,
  currentNode,
  mapView,
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
  applyEventHp,
  applyIntermission,
  checkEventCondition,
  loseableRelicPool,
  relicPool,
  setRunHp,
  setRunPollution,
  type RunDifficulty,
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
  /** 结束时在第几幕（docs/43 Q5 双幕定位用） */
  reachedAct: number;
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
  /** 进 Boss 战前的 HP（docs/45 Q7-6 锈喉死亡构成分析用） */
  hpAtBoss: number | null;
  /** 进 Boss 战前的牌组张数 */
  deckSizeAtBoss: number | null;
  /** 进 Boss 战前的遗物件数 */
  relicsAtBoss: number | null;
  /** 本局是否组出「失控线爆发流」（同一张牌同时有 血怒 + 低血沸腾，docs/23 §10 口径 b） */
  bloodrageBoil: boolean;
  /** 本局是否同时持有 血怒 与 低血沸腾（可不同卡）——诊断 AI 会不会凑对（docs/25 §1.6） */
  bloodrageBoilAny: boolean;
  /** 本局污染峰值（docs/42 T1 分布报告：用于判断"加速出牌 → 加速污染"这条假设） */
  pollutionPeak: number;
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
  /** 难度档（docs/36 T2）；缺省 normal */
  difficulty?: RunDifficulty;
  /** 职业特性（docs/58 §二）；缺省空串 = 无特性（现版基线） */
  traitId?: string;
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

/**
 * 路线评分（docs/48 §五.2）：低血优先休息，否则优先精英/事件，避开战斗与篝火。
 * 只在【可达】的候选里挑——DAG 里点不到的分支不能选。这不算调 AI 强度，只是让它会认路。
 * （全图寻路版也试过，与贪心同分：10 层掉点来自幕长，不来自认路方式。）
 */
function chooseBranchIndex(candidates: readonly { index: number; kind: string }[], run: RunState): number {
  const lowHp = run.hp < run.maxHp * 0.55;
  // docs/48 §五.2：低血偏篝火；否则偏精英/事件（像一个敢打的普通玩家，而不是一味躲精英）
  const order = lowHp
    ? ["rest", "altar", "event", "battle", "elite"]
    : ["elite", "event", "altar", "battle", "rest"];
  for (const kind of order) {
    const hit = candidates.find((c) => c.kind === kind);
    if (hit) return hit.index;
  }
  return candidates[0]?.index ?? 0;
}

/**
 * 事件选项评分（贪心 AI）：优先强化/遗物/卡，HP 越低越避忌付费；赌博按期望值。
 *
 * docs/54：新增效果必须一起进打分表，否则它们全是 0 分——AI 会退化成「总是选第一个」，
 * 于是新型代价（污染换血之类）被无脑吃下，哨兵数字会假性下滑。
 */
function chooseEventOption(
  def: import("../../../src/core/registry").EventDefinition,
  run: RunState,
  relicCount: number,
  loseableRelicCount: number,
): string {
  const hpRatio = run.hp / Math.max(1, run.maxHp);
  const scoreEffect = (kind: string, value: number, count = 1): number => {
    switch (kind) {
      case "gainEnhancement":
        return 30;
      case "gainRelic":
        return 22;
      case "gainCard":
        return 8 * count;
      // 百分比 HP 先折算成点数，再走同一套「HP 越低越怕付」的折扣
      case "hpPercent":
        return ((value * run.maxHp) / 100) * (value < 0 ? (hpRatio < 0.4 ? 0.45 : 0.9) : 0.15);
      case "maxHp":
        return value > 0 ? value * 2.5 : value * 2;
      // 删牌是构筑洁癖的刚需（docs/54 §一 结构性空缺），评分给得比一张普通卡高
      case "removeCard":
        return 14;
      case "upgradeRandom":
        return 12;
      case "loseRelic":
        return -22 * count;
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
    // 条件不满足的选项在 UI 上根本点不动，AI 也不该看见它
    if (
      !checkEventCondition(opt.condition, {
        hp: run.hp,
        maxHp: run.maxHp,
        pollution: run.pollution,
        relicCount,
        loseableRelicCount,
      })
    ) {
      continue;
    }
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

/**
 * 神眼取牌策略（docs/58 §七.2）：仅当（a）神眼本回合可用、（b）牌库里存在比「手里最差的一张」
 * 更值钱的牌时才出手。用 `cardValue` 同一把尺子量手牌与牌库，避免引入第二套估值口径。
 */
function chooseEyePick(state: BattleState, content: ContentDb): string | null {
  if (!eyeAvailable(state)) return null;
  const draw = state.piles.draw;
  if (draw.length === 0) return null;
  const valueOf = (instanceId: string): number => {
    const inst = state.cardInstances[instanceId];
    const def = inst ? content.cards.get(inst.cardId) : undefined;
    return def ? cardValue(def) : 0;
  };
  const worstHand =
    state.piles.hand.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...state.piles.hand.map(valueOf));
  let best: { id: string; value: number } | null = null;
  for (const id of draw) {
    const value = valueOf(id);
    if (!best || value > best.value) best = { id, value };
  }
  if (!best || best.value <= worstHand) return null;
  return best.id;
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
    difficulty: config.difficulty ?? "normal",
    traitId: config.traitId ?? "",
  });
  state = reduce(state, { type: "Noop", actionId: "s" }).state;

  let damageDealt = 0;
  let damageTaken = 0;
  const cardsPlayed: Record<string, number> = {};
  let guard = 0;

  while (state.phase !== "battleEnd" && guard < MAX_BATTLE_ACTIONS) {
    guard += 1;
    // 神眼（docs/58 §七.2）：每回合一次从牌库取牌。sim 只在「牌库里最值钱的一张 > 手里最差的一张」
    // 时才用——既让超级大畸变的收益在报表里可见，又不让 AI 无脑刷牌（那会高估特性）。
    const eyeId = chooseEyePick(state, content);
    if (eyeId !== null) {
      state = reduce(state, { type: "PickFromDraw", actionId: `y${guard}`, instanceId: eyeId }).state;
      continue;
    }
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

export function simulateRun(
  content: ContentDb,
  firstAct: ActDefinition,
  seed: number,
  classId = "bloodwright",
  difficulty: RunDifficulty = "normal",
  /** 多幕连打（docs/40 §九-15）：传 [act1, act2] 即双幕；缺省只打第一幕 */
  acts: readonly ActDefinition[] = [],
  /**
   * 指定随身遗物（docs/41 §五 T1 强度分布）：传了就固定用这一件，
   * 不传则按职业默认偏好（老口径，保证既有基线可复现）。
   */
  companionId?: string,
  /**
   * 职业特性（docs/58 §二）：传了就整局绑定该特性；缺省空串 = 无特性（现版玩法对照组/基线）。
   */
  traitId = "",
): SimResult {
  const cls = content.classes.get(classId) ?? [...content.classes.values()][0];
  if (!cls) throw new Error("内容里没有任何职业定义");
  const actList: readonly ActDefinition[] = acts.length > 0 ? acts : [firstAct];
  let act = actList[0];
  // sim 口径 = 老玩家快照：全部内容已解锁（与 P5 基线口径一致，docs/36 T3）
  const unlocked = [
    ...[...content.cards.keys()],
    ...[...content.relics.keys()],
  ];
  // 随身遗物（docs/38 §一 A-2）：sim 模拟"会挑"的玩家——血械取血泵（卖血联动）、
  // 炉心取压力表（充能联动，即它被下放前的原配），其余回落到池首件。
  const t1 = relicPool(content, 1, unlocked);
  const preferred = classId === "engineer" ? "pressuregauge" : classId === "rustspeaker" ? "whetstone" : "blood_pump";
  const companion =
    companionId !== undefined
      ? companionId
      : t1.includes(preferred)
        ? preferred
        : (t1[0] ?? "");
  let run = createRunState(act, cls, seed, { unlocked, difficulty, companionRelic: companion, traitId });
  const deck: SimCard[] = cls.startDeck.map((cardId) => ({ cardId, upgraded: false, enhancements: [] }));
  const relics = [...(cls.startRelics ?? []), ...(companion ? [companion] : [])];
  // 身份件（docs/55 Q1）：loseRelic 与「可典当」条件都要把它排除在外
  const identityRelics: readonly string[] = cls.startRelics ?? [];

  const cardsPlayed: Record<string, number> = {};
  const cardsPicked: Record<string, number> = {};
  const enhancements: Record<string, number> = {};
  let turns = 0;
  let damageDealt = 0;
  let damageTaken = 0;
  let battles = 0;
  let hpAfterElite: number | null = null;
  let hpAfterBoss: number | null = null;
  let hpAtBoss: number | null = null;
  let deckSizeAtBoss: number | null = null;
  let relicsAtBoss: number | null = null;

  const finish = (outcome: "win" | "lose"): SimResult => ({
    seed,
    outcome,
    nodeReached: run.layerIndex,
    reachedAct: run.actIndex,
    battles,
    turns,
    damageDealt,
    damageTaken,
    cardsPlayed,
    cardsPicked,
    enhancements,
    hpAfterElite,
    hpAfterBoss,
    hpAtBoss,
    deckSizeAtBoss,
    relicsAtBoss,
    bloodrageBoil: deck.some(
      (c) => c.enhancements.includes("bloodrage") && c.enhancements.includes("bloodboil"),
    ),
    bloodrageBoilAny:
      deck.some((c) => c.enhancements.includes("bloodrage")) &&
      deck.some((c) => c.enhancements.includes("bloodboil")),
    pollutionPeak: run.pollutionPeak,
  });

  // 多幕连打：一幕走完 → applyIntermission → 继续第二幕（docs/40 §2.2）
  while (true) {
    act = actList[run.actIndex] ?? act;
    while (!isRunComplete(run, act)) {
      // 树状地图：当前层没选就在【可达候选】里按策略选一个（docs/48 §五.2）
      const view = mapView(run, act);
      const layer = view.layers[run.layerIndex];
    if (!layer) break;
    if (run.picked[run.layerIndex] === undefined) {
      const candidates = layer.nodes
        .map((n, index) => ({ index, kind: n.kind }))
        .filter((c) => view.reachable.includes(layer.nodes[c.index]!.id));
      run = chooseNode(run, act, chooseBranchIndex(candidates, run));
    }
    const node = currentNode(run, act);
    if (!node) break;

    if (isCombatNode(node)) {
      battles += 1;
      // docs/45 Q7-6：记下进 Boss 战时的血量/牌组规模，用于"锈喉死亡构成"分析
      if (node.kind === "boss") {
        hpAtBoss = run.hp;
        deckSizeAtBoss = deck.length;
        relicsAtBoss = relics.length;
      }
      const battle = runBattle(content, {
        battleId: `${act.id}-${node.id}`,
        seed: (run.seed ^ Math.imul(run.layerIndex + 1, 0x9e3779b9)) >>> 0,
        maxHp: run.maxHp,
        energy: cls.player.energy,
        hp: run.hp,
        pollution: run.pollution,
        enemies: rollEncounter(run, node),
        deck,
        relics,
        difficulty: run.difficulty,
        traitId: run.traitId,
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
        const rewards = rollCardRewards(content, act, run, run.layerIndex);
        const pick = bestReward(rewards, content);
        if (pick) {
          deck.push({ cardId: pick, upgraded: false, enhancements: [] });
          cardsPicked[pick] = (cardsPicked[pick] ?? 0) + 1;
        }
      } else if (node.kind === "elite") {
        const relicSeed = (run.seed ^ Math.imul(run.layerIndex + 13, 0x9e3779b9)) >>> 0;
        const relic = rollRelicChoices(content, relics, 1, run.unlocked, [2], relicSeed)[0];
        if (relic && !relics.includes(relic)) relics.push(relic);
        const applied = applyEnhancementChoice(
          content,
          deck,
          rollEnhancementChoices(content, run, run.layerIndex, 3, act.id),
        );
        if (applied) enhancements[applied] = (enhancements[applied] ?? 0) + 1;
      }
      run = advanceNode(run, act);
      continue;
    }

    if (node.kind === "rest") {
      if (run.hp < run.maxHp * 0.7) {
        run = healRun(run, run.maxHp, Math.round(run.maxHp * 0.3));
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
        const optionId = chooseEventOption(
          def,
          run,
          relics.length,
          loseableRelicPool(content, relics, identityRelics).length,
        );
        const seed = (run.seed ^ Math.imul(run.layerIndex + 11, 0x27d4eb2f)) >>> 0;
        const res = resolveEventOption(content, def, optionId, {
          seed,
          ownedRelics: relics,
          classId,
          unlocked: run.unlocked,
          // docs/54：百分比 HP 的分母 / 条件判定 / 随机升级候选，一处都不能少
          maxHp: run.maxHp,
          hp: run.hp,
          pollution: run.pollution,
          identityRelics,
          deckUpgradeable: deck.map((c, i) => (c.upgraded ? -1 : i)).filter((i) => i >= 0),
        });
        if (res) {
          if (res.hpDelta !== 0 || res.maxHpDelta !== 0) {
            run = applyEventHp(run, res.hpDelta, res.maxHpDelta);
          }
          if (res.pollutionDelta !== 0) run = setRunPollution(run, run.pollution + res.pollutionDelta);
          for (const id of res.relicIds) if (!relics.includes(id)) relics.push(id);
          // 去掉一件（docs/54 E5）：sim 与 store 同口径，只从持有列表里摘
          for (const id of res.loseRelicIds) {
            const at = relics.indexOf(id);
            if (at >= 0) relics.splice(at, 1);
          }
          for (const id of res.cardIds) deck.push({ cardId: id, upgraded: false, enhancements: [] });
          // 随机升级（docs/54 E3）
          if (res.upgradeIndex >= 0 && deck[res.upgradeIndex]) {
            deck[res.upgradeIndex] = { ...deck[res.upgradeIndex], upgraded: true };
          }
          // 自选删牌（docs/54 E2）：sim 用 ai.cardValue 挑最差的一张
          if (res.removeCard && deck.length > 1) {
            let worst = 0;
            let worstValue = Infinity;
            for (let i = 0; i < deck.length; i += 1) {
              const cardDef = content.cards.get(deck[i]!.cardId);
              const value = cardDef ? cardValue(cardDef) : 0;
              if (value < worstValue) {
                worstValue = value;
                worst = i;
              }
            }
            deck.splice(worst, 1);
          }
          // 同幕不放回（docs/54 E7）：记账后本节点故事被钉死
          if (!run.seenEvents.some((seen) => seen.layer === run.layerIndex)) {
            run = {
              ...run,
              seenEvents: [...run.seenEvents, { layer: run.layerIndex, eventId: def.id }],
            };
          }
          if (res.gainEnhancement) {
            const applied = applyEnhancementChoice(
              content,
              deck,
              rollEnhancementChoices(content, run, run.layerIndex, 3, act.id),
            );
            if (applied) enhancements[applied] = (enhancements[applied] ?? 0) + 1;
          }
        }
      }
      run = advanceNode(run, act);
      continue;
    }

    // 奖励节点「匣」（docs/49 §六）：免费卡牌三选一，与战斗奖励同结构、不叠加
    if (node.kind === "reward") {
      const rewards = rollCardRewards(content, act, run, run.layerIndex);
      const pick = bestReward(rewards, content);
      if (pick) {
        deck.push({ cardId: pick, upgraded: false, enhancements: [] });
        cardsPicked[pick] = (cardsPicked[pick] ?? 0) + 1;
      }
      run = advanceNode(run, act);
      continue;
    }

    if (node.kind === "altar") {
      const applied = applyEnhancementChoice(
        content,
        deck,
        rollEnhancementChoices(content, run, run.layerIndex),
      );
      if (applied) enhancements[applied] = (enhancements[applied] ?? 0) + 1;
      run = advanceNode(run, act);
      continue;
    }

    run = advanceNode(run, act);
  }

    if (run.actIndex + 1 < actList.length) {
      run = applyIntermission(run);
      // docs/45 Q7 复核发现：真实局幕间还要选一次「圣堂馈赠」（docs/40 §2.3），
      // 原 sim 只结算 applyIntermission、漏了这一项 → 双幕被系统性低估。补上 AI 的选择：
      //   残血 → A 回半血；否则能拿本幕强化就拿 C，拿不到就 B 升级一张牌。
      const nextAct = actList[run.actIndex] ?? act;
      if (run.hp < run.maxHp * 0.5) {
        run = setRunHp(run, Math.min(run.maxHp, run.hp + Math.round(run.maxHp * 0.5)));
      } else {
        const applied = applyEnhancementChoice(
          content,
          deck,
          rollEnhancementChoices(content, run, run.layerIndex, 3, nextAct.id),
        );
        if (applied) enhancements[applied] = (enhancements[applied] ?? 0) + 1;
        else {
          const index = deck.findIndex((c) => !c.upgraded);
          if (index >= 0) deck[index] = { ...deck[index], upgraded: true };
        }
      }
      continue;
    }
    break;
  }

  return finish("win");
}
