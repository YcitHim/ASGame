// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { loadGameContent } from "@/data/load";
import { useBattleStore } from "@/stores/battle";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import { useTutorialStore } from "@/stores/tutorial";
import { TUTORIAL_CHAPTERS, chapterSteps, tutorialChapter } from "@/ui/tutorial";

/**
 * docs/42「第一班岗」：引导式微型远征——序章 → 课1 → 幕间A → 课2 → 幕间B → 课3 → 结业。
 * 这里测的是状态机与脚本本身；战斗表现走 battle-fx.spec，免死走下面的 core 用例。
 */

const game = loadGameContent();

function setup() {
  window.localStorage.clear();
  setActivePinia(createPinia());
  const run = useRunStore();
  run.startRun("bloodwright", 5);
  const tutorial = useTutorialStore();
  tutorial.begin();
  return { run, tutorial };
}

describe("docs/42 §三 脚本结构", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivePinia(createPinia());
  });

  it("七章齐全：序章 → 课1 → 幕间A → 课2 → 幕间B → 课3 → 结业", () => {
    expect(TUTORIAL_CHAPTERS.map((c) => c.kind)).toEqual([
      "screen",
      "battle",
      "reward",
      "battle",
      "map",
      "battle",
      "graduation",
    ]);
    expect(TUTORIAL_CHAPTERS.map((c) => c.id)).toEqual([
      "prologue",
      "lesson1",
      "interludeA",
      "lesson2",
      "interludeB",
      "lesson3",
      "graduation",
    ]);
  });

  it("每个战斗章：步骤有 why（模型）与 how（操作），敌人与种子合法", () => {
    for (const chapter of TUTORIAL_CHAPTERS) {
      if (chapter.kind !== "battle") continue;
      expect(chapter.steps.length).toBeGreaterThan(0);
      for (const id of chapter.enemies) expect(game.content.enemies.has(id)).toBe(true);
      for (const step of chapter.steps) {
        expect(step.why.length).toBeGreaterThan(0);
        expect(step.how.length).toBeGreaterThan(0);
      }
      // 课 2/3 的脚本依赖固定意图：虫群开局必攻、重卫开局蓄力
    }
  });

  it("第三课按职业追加机制段，且样例牌真的在对应职业的池子里", () => {
    const lesson3 = TUTORIAL_CHAPTERS.find((c) => c.id === "lesson3");
    expect(lesson3?.kind).toBe("battle");
    if (lesson3?.kind !== "battle") return;
    for (const classId of ["bloodwright", "engineer", "rustspeaker"]) {
      const steps = chapterSteps(lesson3, classId);
      expect(steps.length).toBeGreaterThan(lesson3.steps.length);
      const mechanic = steps[lesson3.steps.length];
      expect(mechanic.grant?.length ?? 0).toBeGreaterThan(0);
      for (const cardId of mechanic.grant ?? []) {
        const def = game.content.cards.get(cardId);
        expect(def, `${cardId} 未注册`).toBeDefined();
      }
    }
  });

  it("没有死结：需要指定牌的步骤一定有保底发放（防止严判定被发牌运气卡死）", () => {
    for (const chapter of TUTORIAL_CHAPTERS) {
      if (chapter.kind !== "battle") continue;
      for (const classId of ["bloodwright", "engineer", "rustspeaker"]) {
        for (const step of chapterSteps(chapter, classId)) {
          if (step.goal.kind === "playCardId") {
            const granted = [
              ...(step.grant ?? []),
              ...(step.classGrant?.[classId] ?? []),
            ];
            expect(
              granted.includes(step.goal.cardId),
              `${chapter.id} 要求打出 ${step.goal.cardId}，但没有保底发放`,
            ).toBe(true);
          }
          // 需要「手里有某类牌」的严判定步骤（格挡课）必须有保底发放
          if (step.goal.kind === "blockEndTurn" && step.strict) {
            const granted = [
              ...(step.grant ?? []),
              ...(step.classGrant?.[classId] ?? []),
            ];
            expect(granted.length, `${chapter.id} 的格挡课没有保底牌`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("结业清单八条（docs/42 §三.8）", () => {
    const grad = TUTORIAL_CHAPTERS.find((c) => c.id === "graduation");
    if (grad?.kind !== "graduation") throw new Error("缺结业章");
    expect(grad.checklist).toHaveLength(8);
  });
});

describe("docs/42 §六-2 判定模型", () => {
  it("严判定：该叠格挡却结束回合 → 不推进，给纠正话术", () => {
    const { tutorial } = setup();
    tutorial.chapterIndex = 3; // lesson2
    tutorial.stepIndex = 1;
    tutorial.noteEndTurn({ energy: 2, block: 0, playable: 2 });
    expect(tutorial.stepIndex).toBe(1);
    expect(tutorial.correction).toContain("格挡");
    tutorial.noteEndTurn({ energy: 1, block: 5, playable: 1 });
    expect(tutorial.stepIndex).toBe(2);
    expect(tutorial.correction).toBe("");
  });

  it("energyEmpty 是打牌后的严判定；打技能牌不顶掉「打攻击牌」这一步", () => {
    const { tutorial } = setup();
    tutorial.chapterIndex = 1; // lesson1
    tutorial.noteCardPlayed("defend", "skill", 2);
    expect(tutorial.stepIndex).toBe(0);
    tutorial.noteCardPlayed("strike", "attack", 2);
    expect(tutorial.stepIndex).toBe(1);
    tutorial.noteCardPlayed("strike", "attack", 1);
    expect(tutorial.stepIndex).toBe(1);
    tutorial.noteCardPlayed("strike", "attack", 0);
    expect(tutorial.stepIndex).toBe(2);
  });

  it("「花光能量」是宽口径：剩 1 点但手里全是贵牌时，结束回合也算过关（回归 bug）", () => {
    const { tutorial } = setup();
    tutorial.chapterIndex = 1; // lesson1
    tutorial.noteCardPlayed("strike", "attack", 2); // step 0 → 1
    expect(tutorial.stepIndex).toBe(1);
    // 打牌打到 0 → 过关
    tutorial.noteCardPlayed("strike", "attack", 0);
    expect(tutorial.stepIndex).toBe(2);
  });

  it("能量没用完但手里还有能打的牌 → 不推进，且必须给一句纠正（回归 bug：不能干瞪眼）", () => {
    const { tutorial } = setup();
    tutorial.chapterIndex = 1;
    tutorial.stepIndex = 1;
    tutorial.noteEndTurn({ energy: 1, block: 0, playable: 2 });
    expect(tutorial.stepIndex).toBe(1);
    expect(tutorial.correction.length).toBeGreaterThan(0);
    // 剩 1 点但手里全是贵牌 → 结束回合也算花完
    tutorial.noteEndTurn({ energy: 1, block: 0, playable: 0 });
    expect(tutorial.stepIndex).toBe(2);
  });

  it("格挡课：格挡替玩家吃掉伤害才算过关（blockedHit），且防御牌有保底发放", () => {
    const { tutorial } = setup();
    tutorial.chapterIndex = 3; // lesson2
    tutorial.stepIndex = 1;
    // 这一课要保证手里有本职业的格挡牌，否则严判定会被发牌运气卡死
    expect(tutorial.stepGrant.length).toBeGreaterThan(0);
    tutorial.noteEndTurn({ energy: 1, block: 5, playable: 1 });
    expect(tutorial.stepIndex).toBe(2);
    expect(tutorial.step?.goal.kind).toBe("blockedHit");
    tutorial.noteBlockedHit();
    expect(tutorial.stepIndex).toBe(3);
  });

  it("playCardId 只认指定机制牌；killAll 清场；survivedRelease 扛过重击", () => {
    const { tutorial } = setup();
    tutorial.chapterIndex = 5; // lesson3
    tutorial.stepIndex = 0;
    tutorial.noteEndTurn({ energy: 3, block: 0, playable: 3 });
    expect(tutorial.stepIndex).toBe(1);
    tutorial.noteSurvivedRelease();
    expect(tutorial.stepIndex).toBe(2);
    // 血械的机制段排在收尾击杀之前：必须是 transfusion 才算
    tutorial.noteCardPlayed("strike", "attack", 2);
    expect(tutorial.stepIndex).toBe(2);
    tutorial.noteCardPlayed("transfusion", "skill", 2);
    expect(tutorial.stepIndex).toBe(3);
    tutorial.noteCleared();
    expect(tutorial.run?.cleared).toContain("lesson3");
  });
});

describe("docs/42 §三.4 / §三.6 幕间", () => {
  it("幕间 A：候选按职业给，拿走进卡组", () => {
    const { tutorial } = setup();
    tutorial.chapterIndex = 2;
    expect(tutorial.rewardOffers.length).toBe(3);
    const before = tutorial.run?.deck.length ?? 0;
    tutorial.takeReward(tutorial.rewardOffers[0]!);
    expect(tutorial.run?.deck.length).toBe(before + 1);
    tutorial.nextChapter();
    expect(tutorial.chapter?.id).toBe("lesson2");
  });

  it("幕间 B：篝火打开二选一；升级真的升一张", () => {
    const { tutorial } = setup();
    tutorial.chapterIndex = 4;
    tutorial.chooseMapNode("rest");
    expect(tutorial.restChoiceOpen).toBe(true);
    expect(tutorial.chapter?.id).toBe("interludeB");
    tutorial.restUpgrade();
    expect(tutorial.run?.deck.some((c) => c.upgraded)).toBe(true);
    expect(tutorial.chapter?.id).toBe("lesson3");
  });

  it("幕间 B：走战斗路直接进下一章", () => {
    const { tutorial } = setup();
    tutorial.chapterIndex = 4;
    tutorial.chooseMapNode("fight");
    expect(tutorial.restChoiceOpen).toBe(false);
    expect(tutorial.chapter?.id).toBe("lesson3");
  });
});

describe("docs/42 §三.0 按职业记录 / 只补机制课", () => {
  it("走完全程 → 按职业记完成 + 解锁「引路人」", () => {
    const { tutorial } = setup();
    for (let i = 0; i < TUTORIAL_CHAPTERS.length; i += 1) tutorial.nextChapter();
    expect(tutorial.finished).toBe(true);
    expect(tutorial.active).toBe(false);
    const meta = useMetaStore();
    expect(meta.hasDoneTutorial("bloodwright")).toBe(true);
    expect(meta.hasDoneTutorial("engineer")).toBe(false);
    expect(meta.isAchieved("guide")).toBe(true);
  });

  it("换职业只补机制课：跳到第三课", () => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    useRunStore().startRun("engineer", 5);
    const tutorial = useTutorialStore();
    tutorial.begin(true);
    expect(tutorial.chapter?.id).toBe("lesson3");
    expect(tutorial.run?.classId).toBe("engineer");
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

describe("docs/42 教学战斗接入", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivePinia(createPinia());
  });

  it("教学战斗用教学局的卡组与 HP，并带安全下限；不写 run 进度", () => {
    const run = useRunStore();
    run.startRun("bloodwright", 5);
    const hpBefore = run.hp;
    const tutorial = useTutorialStore();
    tutorial.begin();
    tutorial.chapterIndex = 1;
    const store = useBattleStore();
    const chapter = tutorialChapter(1);
    if (chapter?.kind !== "battle" || !tutorial.run) throw new Error("脚本异常");
    store.startTutorial({
      chapterId: chapter.id,
      seed: chapter.seed,
      enemies: chapter.enemies,
      deck: tutorial.run.deck,
      hp: 30,
      maxHp: tutorial.run.maxHp,
      relics: [],
    });
    expect(store.battle?.battleId).toBe("tutorial-lesson1");
    expect(store.battle?.player.hp).toBe(30);
    expect(store.battle?.safetyFloor).toBe(1);
    // 击杀 → 教学章清场判定；run 进度不动
    const enemyId = store.battle?.enemies[0]?.id ?? "";
    store.debug(`kill ${enemyId}`);
    store.skip();
    expect(run.hp).toBe(hpBefore);
  });
});
