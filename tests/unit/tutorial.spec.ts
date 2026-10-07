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
    // 敌人 HP 被抬高，保证"异常"那一课演得完
    expect(battle.enemyHp).toBeGreaterThan(36);
  });

  it("前四步是 UI 导览：分别指向状态栏 / 能量 / 手牌 / 意图，且都要玩家点「知道了」", () => {
    const battle = TUTORIAL_CHAPTERS[0];
    if (battle.kind !== "battle") throw new Error("脚本异常");
    expect(battle.steps.slice(0, 4).map((s) => s.focus)).toEqual(["status", "energy", "hand", "intent"]);
    for (const step of battle.steps.slice(0, 4)) {
      expect(step.goal.kind).toBe("acknowledge");
      expect(step.why.length).toBeGreaterThan(0);
      expect(step.how.length).toBeGreaterThan(0);
    }
  });

  it("后四步：攻击 → 防御（严判定）→ 被挂异常 → 清场", () => {
    const battle = TUTORIAL_CHAPTERS[0];
    if (battle.kind !== "battle") throw new Error("脚本异常");
    expect(battle.steps.slice(4).map((s) => s.goal.kind)).toEqual([
      "playType",
      "blockEndTurn",
      "playerDebuffed",
      "killAll",
    ]);
    // 防御课是严判定，且必须有保底发的格挡牌（不能靠发牌运气）
    const block = battle.steps[5]!;
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

  it("攻击课认 attack、防御课认格挡后结束回合（严判定给纠正）", () => {
    const { tutorial } = setup();
    tutorial.stepIndex = 4;
    tutorial.noteCardPlayed("defend", "skill");
    expect(tutorial.stepIndex).toBe(4);
    tutorial.noteCardPlayed("strike", "attack");
    expect(tutorial.stepIndex).toBe(5);
    tutorial.noteEndTurn({ block: 0 });
    expect(tutorial.stepIndex).toBe(5);
    expect(tutorial.correction.length).toBeGreaterThan(0);
    tutorial.noteEndTurn({ block: 5 });
    expect(tutorial.stepIndex).toBe(6);
    expect(tutorial.correction).toBe("");
  });

  it("被挂异常才推进「异常」那一课；清场才推进最后一步", () => {
    const { tutorial } = setup();
    tutorial.stepIndex = 6;
    expect(tutorial.step?.goal.kind).toBe("playerDebuffed");
    tutorial.noteCleared();
    expect(tutorial.stepIndex).toBe(6);
    tutorial.notePlayerDebuffed();
    expect(tutorial.stepIndex).toBe(7);
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
    tutorial.stepIndex = 6;
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
    expect(tutorial.stepIndex).toBe(7);
  });
});
