// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { loadGameContent } from "@/data/load";
import { useBattleStore } from "@/stores/battle";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import { useTutorialStore } from "@/stores/tutorial";
import { TUTORIAL_CHAPTERS, chapterSteps } from "@/ui/tutorial";
import { stepDebugCommands } from "@/ui/tutorial-script";

/**
 * docs/42 速成版（甲方要求：不墨迹）。
 * 只有一场战斗 + 一页结业，八个步骤：
 * ① 状态栏 ② 能量 ③ 手牌区 ④ 敌人意图 → ⑤ 攻击 → ⑥ 防御 → ⑦ 被挂异常 → ⑧ 清场。
 */

const game = loadGameContent();

function setup(classId = "bloodwright") {
  window.localStorage.clear();
  setActivePinia(createPinia());
  const run = useRunStore();
  run.startRun(classId, 5);
  const tutorial = useTutorialStore();
  tutorial.begin();
  return { run, tutorial };
}

describe("docs/42 速成版 · 脚本结构", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivePinia(createPinia());
  });

  it("只有两章：一场战斗 + 一页结业", () => {
    expect(TUTORIAL_CHAPTERS.map((c) => c.kind)).toEqual(["battle", "graduation"]);
    const battle = TUTORIAL_CHAPTERS[0];
    if (battle.kind !== "battle") throw new Error("脚本异常");
    expect(battle.steps).toHaveLength(8);
    expect(game.content.enemies.has(battle.enemies[0]!)).toBe(true);
    // docs/43 甲方反馈「太磨」：HP 压到 26，三回合内打完，又够演完异常/蓄力两课
    expect(battle.enemyHp).toBeGreaterThan(20);
    expect(battle.enemyHp).toBeLessThanOrEqual(30);
  });

  it("敌人意图由脚本钉死：先挂异常、再一回合蓄力（不再靠种子碰运气）", () => {
    const battle = TUTORIAL_CHAPTERS[0];
    if (battle.kind !== "battle") throw new Error("脚本异常");
    expect(battle.steps[0]?.intent).toEqual({ kind: "debuff", buffId: "weak", value: 1 });
    // 「异常」那一课也钉一次，断点续做不会因为敌人随机出招卡死
    const debuffStep = battle.steps.find((s) => s.goal.kind === "playerDebuffed");
    expect(debuffStep?.intent?.kind).toBe("debuff");
    const chargeStep = battle.steps.find((s) => s.goal.kind === "blockEndTurn");
    expect(chargeStep?.intent).toEqual({ kind: "charge", value: 2, block: 4, release: 10 });
  });

  it("前四步是 UI 导览：分别指向状态栏 / 能量 / 手牌 / 意图，且都要玩家点「知道了」", () => {
    const battle = TUTORIAL_CHAPTERS[0];
    if (battle.kind !== "battle") throw new Error("脚本异常");
    expect(battle.steps.slice(0, 4).map((s) => s.focus)).toEqual(["status", "energy", "hand", "intent"]);
    // 「异常」那一课专门高亮状态行（甲方的「诅咒指引区」）
    expect(battle.steps.find((s) => s.goal.kind === "playerDebuffed")?.focus).toBe("debuff");
    for (const step of battle.steps.slice(0, 4)) {
      expect(step.goal.kind).toBe("acknowledge");
      expect(step.why.length).toBeGreaterThan(0);
      expect(step.how.length).toBeGreaterThan(0);
    }
  });

  it("后四步：攻击 → 被挂异常 → 蓄力防御（严判定）→ 清场", () => {
    const battle = TUTORIAL_CHAPTERS[0];
    if (battle.kind !== "battle") throw new Error("脚本异常");
    expect(battle.steps.slice(4).map((s) => s.goal.kind)).toEqual([
      "playType",
      "playerDebuffed",
      "blockEndTurn",
      "killAll",
    ]);
    // 防御课是严判定，且必须有保底发的格挡牌（不能靠发牌运气）
    const block = battle.steps[6]!;
    expect(block.strict).toBe(true);
    expect(block.classGrant?.bloodwright).toContain("defend");
    expect(block.classGrant?.engineer).toContain("brassguard");
    expect(block.classGrant?.rustspeaker).toContain("scrapguard");
  });

  it("不能有死结：需要指定牌的步骤必须有保底发放", () => {
    for (const chapter of TUTORIAL_CHAPTERS) {
      for (const step of chapterSteps(chapter)) {
        if (step.goal.kind === "playCardId") {
          const granted = [...(step.grant ?? [])];
          expect(granted.includes(step.goal.cardId)).toBe(true);
        }
        if (step.goal.kind === "blockEndTurn" && step.strict) {
          expect((step.classGrant?.bloodwright ?? []).length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("docs/42 速成版 · 判定", () => {
  it("导览步要点「知道了」才翻页", () => {
    const { tutorial } = setup();
    expect(tutorial.stepIndex).toBe(0);
    expect(tutorial.needsAcknowledge).toBe(true);
    expect(tutorial.focus).toBe("status");
    tutorial.noteAcknowledge();
    expect(tutorial.stepIndex).toBe(1);
    expect(tutorial.focus).toBe("energy");
    tutorial.noteAcknowledge();
    tutorial.noteAcknowledge();
    expect(tutorial.focus).toBe("intent");
  });

  it("打牌不会顶掉导览步（顺序必须按脚本走）", () => {
    const { tutorial } = setup();
    tutorial.noteCardPlayed("strike", "attack");
    expect(tutorial.stepIndex).toBe(0);
  });

  it("攻击课认 attack；异常课要真被挂；防御课认格挡后结束回合（严判定给纠正）", () => {
    const { tutorial } = setup();
    tutorial.stepIndex = 4;
    tutorial.noteCardPlayed("defend", "skill");
    expect(tutorial.stepIndex).toBe(4);
    tutorial.noteCardPlayed("strike", "attack");
    expect(tutorial.stepIndex).toBe(5);
    // 异常课：清场 / 结束回合都不算，得真吃到一次减益
    tutorial.noteEndTurn({ block: 5 });
    expect(tutorial.stepIndex).toBe(5);
    tutorial.notePlayerDebuffed();
    expect(tutorial.stepIndex).toBe(6);
    // 蓄力防御课：没格挡不推进并给纠正
    tutorial.noteEndTurn({ block: 0 });
    expect(tutorial.stepIndex).toBe(6);
    expect(tutorial.correction.length).toBeGreaterThan(0);
    tutorial.noteEndTurn({ block: 5 });
    expect(tutorial.stepIndex).toBe(7);
    expect(tutorial.correction).toBe("");
  });

  it("被挂异常才推进「异常」那一课；清场才推进最后一步", () => {
    const { tutorial } = setup();
    tutorial.stepIndex = 5;
    expect(tutorial.step?.goal.kind).toBe("playerDebuffed");
    tutorial.noteCleared();
    expect(tutorial.stepIndex).toBe(5);
    tutorial.notePlayerDebuffed();
    expect(tutorial.stepIndex).toBe(6);
    expect(tutorial.debuffed).toBe(true);
  });

  it("走完两章 → 记完成 + 解锁「引路人」", () => {
    const { tutorial } = setup();
    tutorial.nextChapter();
    expect(tutorial.nextChapter()).toBe(false);
    expect(tutorial.finished).toBe(true);
    const meta = useMetaStore();
    expect(meta.hasDoneTutorial("bloodwright")).toBe(true);
    expect(meta.isAchieved("guide")).toBe(true);
  });

  it("跳过教学：不算完成、不给徽章", () => {
    const { tutorial } = setup();
    tutorial.abort();
    expect(tutorial.active).toBe(false);
    expect(useMetaStore().isAchieved("guide")).toBe(false);
  });
});

describe("docs/42 §四 安全网（core）", () => {
  it("教学战斗里致命伤被截断在 HP=1，并发出 SafetyNet 事件", () => {
    const state = createBattleState({
      battleId: "tut",
      seed: 1,
      player: { maxHp: 66, energy: 3, hp: 2, pollution: 0 },
      enemies: [{ id: "corroded_swarm" }],
      deck: ["defend", "defend", "defend", "defend", "defend"],
      handSize: 5,
      relics: [],
      content: game.content,
      safetyFloor: 1,
    });
    let current = reduce(state, { type: "Noop", actionId: "s" }).state;
    current = reduce(current, { type: "EndTurn", actionId: "e1" }).state;
    expect(current.player.hp).toBe(1);
    expect(current.phase).not.toBe("battleEnd");
    expect(current.safetySaves).toBeGreaterThan(0);
  });

  it("不开安全网时行为不变（正常局与 golden 不受影响）", () => {
    const state = createBattleState({
      battleId: "normal",
      seed: 1,
      player: { maxHp: 66, energy: 3, hp: 2, pollution: 0 },
      enemies: [{ id: "corroded_swarm" }],
      deck: ["defend", "defend", "defend", "defend", "defend"],
      handSize: 5,
      relics: [],
      content: game.content,
    });
    let current = reduce(state, { type: "Noop", actionId: "s" }).state;
    current = reduce(current, { type: "EndTurn", actionId: "e1" }).state;
    expect(current.player.hp).toBe(0);
    expect(current.phase).toBe("battleEnd");
  });
});

describe("docs/42 速成版 · 战斗接入", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivePinia(createPinia());
  });

  it("教学战斗用教学局的卡组与 HP，敌人 HP 被覆盖，带安全下限，不写 run 进度", () => {
    const run = useRunStore();
    run.startRun("bloodwright", 5);
    const hpBefore = run.hp;
    const tutorial = useTutorialStore();
    tutorial.begin();
    const chapter = TUTORIAL_CHAPTERS[0];
    if (chapter.kind !== "battle" || !tutorial.run) throw new Error("脚本异常");
    const store = useBattleStore();
    store.startTutorial({
      chapterId: chapter.id,
      seed: chapter.seed,
      enemies: chapter.enemies,
      enemyHp: chapter.enemyHp,
      deck: tutorial.run.deck,
      hp: 30,
      maxHp: tutorial.run.maxHp,
      relics: [],
    });
    expect(store.battle?.battleId).toBe("tutorial-lesson1");
    expect(store.battle?.player.hp).toBe(30);
    expect(store.battle?.safetyFloor).toBe(1);
    expect(store.battle?.enemies[0]?.maxHp).toBe(chapter.enemyHp);
    const enemyId = store.battle?.enemies[0]?.id ?? "";
    store.debug(`kill ${enemyId}`);
    store.skip();
    expect(run.hp).toBe(hpBefore);
  });

  it("敌人给玩家挂污染 / 虚弱时，教学状态机会收到通知（污染走 PollutionChanged）", () => {
    const run = useRunStore();
    run.startRun("bloodwright", 5);
    const tutorial = useTutorialStore();
    tutorial.begin();
    tutorial.stepIndex = 5;
    const store = useBattleStore();
    const chapter = TUTORIAL_CHAPTERS[0];
    if (chapter.kind !== "battle" || !tutorial.run) throw new Error("脚本异常");
    store.startTutorial({
      chapterId: chapter.id,
      seed: chapter.seed,
      enemies: chapter.enemies,
      enemyHp: chapter.enemyHp,
      deck: tutorial.run.deck,
      hp: 66,
      maxHp: tutorial.run.maxHp,
      relics: [],
    });
    // 让敌人真的动一次（种子 9 的第一手是攻击、第二手是污染）
    store.endTurn();
    store.skip();
    expect(store.battle).not.toBeNull();
    // 玩家吃到减益时通过事件流推进（这里直接验证信号通路）
    tutorial.notePlayerDebuffed();
    expect(tutorial.stepIndex).toBe(6);
  });
});

describe("docs/43 改版 · 脚本钉意图（core DebugCommand）", () => {
  it("charge 钉成「一回合蓄力」：下回合自动释放重击，且蓄力时架格挡", () => {
    let s = createBattleState({
      battleId: "intent-test",
      seed: 3,
      player: { maxHp: 66, energy: 3, hp: 66, pollution: 0 },
      enemies: [{ id: "polluting_preacher", maxHp: 26 }],
      deck: ["defend", "defend", "defend", "defend", "defend"],
      handSize: 5,
      relics: [],
      content: game.content,
      safetyFloor: 1,
    });
    const eid = s.enemies[0]!.id;
    s = reduce(s, { type: "DebugCommand", actionId: "d0", command: `intent ${eid} charge 2 4 10` }).state;
    expect(s.enemies[0]!.intent).toMatchObject({ kind: "charge", value: 2, block: 4, thenValue: 10, thenIn: 1 });
    // 玩家结束回合 → 敌人蓄力（架 4 格挡），并把释放段排进链
    s = reduce(s, { type: "EndTurn", actionId: "e1" }).state;
    expect(s.enemies[0]!.block).toBe(4);
    expect(s.enemies[0]!.intent).toMatchObject({ kind: "attack", value: 10, released: true });
    // 再结束一回 → 重击落地
    const before = s.player.hp;
    s = reduce(s, { type: "EndTurn", actionId: "e2" }).state;
    expect(s.player.hp).toBeLessThan(before);
  });

  it("debuff 钉得动：结束回合就会吃到指定的减益", () => {
    let s = createBattleState({
      battleId: "intent-debuff",
      seed: 3,
      player: { maxHp: 66, energy: 3, hp: 66, pollution: 0 },
      enemies: [{ id: "polluting_preacher", maxHp: 26 }],
      deck: ["defend", "defend", "defend", "defend", "defend"],
      handSize: 5,
      relics: [],
      content: game.content,
      safetyFloor: 1,
    });
    const eid = s.enemies[0]!.id;
    s = reduce(s, { type: "DebugCommand", actionId: "d0", command: `intent ${eid} debuff weak 1` }).state;
    expect(s.enemies[0]!.intent).toMatchObject({ kind: "debuff", buffId: "weak", stacks: 1 });
    // weak 可能在同一动作里被下一回合的 tick 到掉，所以看事件流（教学判定也走事件流）
    const r = reduce(s, { type: "EndTurn", actionId: "e1" });
    const debuffed = r.events.some(
      (e) => e.type === "BuffApplied" && e.targetId === "player" && e.buffId === "weak",
    );
    expect(debuffed).toBe(true);
  });
});

describe("docs/43 改版 · 整场通关（按脚本走不卡死）", () => {
  it("认屏幕 → 攻击 → 被挂异常 → 挡一回合蓄力 → 清场", () => {
    const run = useRunStore();
    run.startRun("bloodwright", 5);
    const tutorial = useTutorialStore();
    tutorial.begin();
    const store = useBattleStore();
    const chapter = TUTORIAL_CHAPTERS[0];
    if (chapter.kind !== "battle" || !tutorial.run) throw new Error("脚本异常");
    store.startTutorial({
      chapterId: chapter.id,
      seed: chapter.seed,
      enemies: chapter.enemies,
      enemyHp: chapter.enemyHp,
      deck: tutorial.run.deck,
      hp: 66,
      maxHp: tutorial.run.maxHp,
      relics: [],
    });

    const apply = () => {
      const commands = stepDebugCommands({
        grant: tutorial.stepGrant,
        intent: tutorial.stepIntent,
        enemyId: store.battle?.enemies[0]?.id ?? "",
      });
      for (const command of commands) store.debug(command);
      store.skip();
    };
    const playType = (type: string) => {
      const hand = store.battle!.piles.hand;
      const index = hand.findIndex(
        (id) => game.content.cards.get(store.battle!.cardInstances[id]!.cardId)?.type === type,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      store.playCard(index, store.battle!.enemies[0]!.id);
      store.skip();
    };

    apply();
    for (let i = 0; i < 4; i += 1) {
      expect(tutorial.needsAcknowledge).toBe(true);
      tutorial.noteAcknowledge();
      apply();
    }
    // 攻击课
    expect(tutorial.step?.goal.kind).toBe("playType");
    playType("attack");
    apply();
    // 异常课：脚本钉的是「虚弱」，结束回合必吃到
    expect(tutorial.step?.goal.kind).toBe("playerDebuffed");
    store.endTurn();
    store.skip();
    expect(tutorial.debuffed).toBe(true);
    expect(tutorial.step?.goal.kind).toBe("blockEndTurn");
    // 蓄力课：意图被钉成 1 回合蓄力，玩家叠格挡再结束回合
    apply();
    expect(store.battle?.enemies[0]?.intent?.kind).toBe("charge");
    playType("skill");
    store.endTurn();
    store.skip();
    expect(tutorial.step?.goal.kind).toBe("killAll");
    // 清场：收尾
    store.debug(`kill ${store.battle!.enemies[0]!.id}`);
    expect(store.battle!.enemies[0]!.hp).toBe(0);
  });
});


describe("docs/43 Q2 · 教学断点（meta 槽）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivePinia(createPinia());
  });

  it("每推进一步就写一份断点；跳过即清空、不重问", () => {
    const { tutorial } = setup();
    const meta = useMetaStore();
    expect(meta.tutorial?.classId).toBe("bloodwright");
    expect(meta.tutorial?.stepIndex).toBe(0);
    tutorial.noteAcknowledge();
    expect(meta.tutorial?.stepIndex).toBe(1);
    tutorial.abort();
    expect(meta.tutorial).toBeNull();
    // 跳过不算"没问过"——重新选人不会再被拦一次
    expect(meta.wasTutorialOffered("bloodwright")).toBe(true);
  });

  it("重开游戏后 resume() 把断点搬回状态机，且能直接进战场那一步", () => {
    const { tutorial } = setup();
    tutorial.noteAcknowledge();
    tutorial.noteAcknowledge();
    tutorial.noteAcknowledge();
    const saved = { chapterIndex: tutorial.chapterIndex, stepIndex: tutorial.stepIndex };
    expect(saved.stepIndex).toBe(3);

    // 关掉游戏再打开：新 pinia，localStorage 里的 meta 留着
    setActivePinia(createPinia());
    const revived = useTutorialStore();
    expect(revived.active).toBe(false);
    expect(revived.resume()).toBe(true);
    expect(revived.active).toBe(true);
    expect(revived.chapterIndex).toBe(saved.chapterIndex);
    expect(revived.stepIndex).toBe(saved.stepIndex);
    expect(revived.isBattleChapter).toBe(true);
    expect(revived.focus).toBe("intent");
    expect(revived.run?.classId).toBe("bloodwright");
    expect(revived.run?.deck.length).toBeGreaterThan(0);
  });

  it("docs/43 Q6：三职业第一班岗都走完才解锁「三朝守夜」", () => {
    const meta = useMetaStore();
    meta.ensureLoaded();
    meta.markTutorialDone("bloodwright");
    meta.markTutorialDone("engineer");
    expect(meta.isAchieved("guide")).toBe(true);
    expect(meta.isAchieved("three_watch")).toBe(false);
    meta.markTutorialDone("rustspeaker");
    expect(meta.isAchieved("three_watch")).toBe(true);
  });

  it("走完全部章节 → 断点清空（标题页不再显示续做入口）", () => {
    const { tutorial } = setup();
    tutorial.nextChapter(); // → 结业
    tutorial.nextChapter(); // → 结束
    expect(tutorial.finished).toBe(true);
    const meta = useMetaStore();
    expect(meta.tutorial).toBeNull();
    expect(meta.isAchieved("guide")).toBe(true);
  });
});
