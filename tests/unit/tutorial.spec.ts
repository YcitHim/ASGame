// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { loadGameContent } from "@/data/load";
import { useBattleStore } from "@/stores/battle";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import { useTutorialStore } from "@/stores/tutorial";
import { TUTORIAL_STAGES } from "@/ui/tutorial";

/** docs/41 §4.3：教学遭遇战——固定脚本 3 场、做对才推进、可跳过、完成只给徽章。 */

const game = loadGameContent();

describe("docs/41 §4.3 教学脚本", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivePinia(createPinia());
  });

  it("恰好 3 场，每场有主题、敌人、固定种子与步骤", () => {
    expect(TUTORIAL_STAGES).toHaveLength(3);
    for (const stage of TUTORIAL_STAGES) {
      expect(stage.title.length).toBeGreaterThan(0);
      expect(stage.theme.length).toBeGreaterThan(0);
      expect(stage.enemies.length).toBeGreaterThan(0);
      expect(stage.steps.length).toBeGreaterThan(0);
      for (const id of stage.enemies) expect(game.content.enemies.has(id)).toBe(true);
      for (const step of stage.steps) expect(step.hint.length).toBeGreaterThan(0);
    }
    // 第三场的敌人必须真的会蓄力，否则"蓄力与爆发"这一课立不住
    const chargeable = game.content.enemies.get(TUTORIAL_STAGES[2].enemies[0]!);
    expect(chargeable?.intents.some((e) => e.intent.kind === "charge")).toBe(true);
  });

  it("做对才推进：提示要攻击牌时，打技能牌不推进", () => {
    const tutorial = useTutorialStore();
    tutorial.begin();
    expect(tutorial.stepIndex).toBe(0);
    tutorial.notePlay("skill");
    expect(tutorial.stepIndex).toBe(0);
    tutorial.notePlay("attack");
    expect(tutorial.stepIndex).toBe(1);
    tutorial.notePlay("attack");
    expect(tutorial.stepIndex).toBe(2);
    tutorial.noteEndTurn();
    expect(tutorial.stepIndex).toBe(2);
  });

  it("三场依次走完：前两场返回 next，最后一场收尾并解锁「引路人」", () => {
    const tutorial = useTutorialStore();
    const meta = useMetaStore();
    tutorial.begin();
    expect(tutorial.completeStage()).toBe("next");
    expect(tutorial.stageIndex).toBe(1);
    expect(tutorial.stepIndex).toBe(0);
    expect(tutorial.completeStage()).toBe("next");
    expect(tutorial.stageIndex).toBe(2);
    expect(tutorial.completeStage()).toBe("done");
    expect(tutorial.active).toBe(false);
    expect(tutorial.finished).toBe(true);
    expect(meta.isAchieved("guide")).toBe(true);
    expect(meta.tutorialDone).toBe(true);
  });

  it("跳过教学：不算完成、不给徽章", () => {
    const tutorial = useTutorialStore();
    const meta = useMetaStore();
    tutorial.begin();
    tutorial.notePlay("attack");
    tutorial.abort();
    expect(tutorial.active).toBe(false);
    expect(tutorial.finished).toBe(false);
    expect(meta.isAchieved("guide")).toBe(false);
  });
});

describe("docs/41 §4.3 教学战斗", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivePinia(createPinia());
  });

  it("教学战斗用脚本敌人与固定种子，且不写 run 进度", () => {
    const run = useRunStore();
    run.startRun("bloodwright", 5);
    const hpBefore = run.hp;
    const store = useBattleStore();
    const tutorial = useTutorialStore();
    tutorial.begin();
    const stage = TUTORIAL_STAGES[0];
    store.startTutorial({ stageId: stage.id, seed: stage.seed, enemies: stage.enemies });
    expect(store.tutorialConfig?.stageId).toBe(stage.id);
    expect(store.battle?.battleId).toBe(`tutorial-${stage.id}`);
    expect(store.battle?.enemies.map((e) => e.defId)).toEqual([...stage.enemies]);
    // 打完一场也不该动远征的 HP（这里用击杀模拟战斗结束）
    const enemyId = store.battle?.enemies[0]?.id ?? "";
    store.debug(`kill ${enemyId}`);
    store.skip();
    expect(run.hp).toBe(hpBefore);
  });

  it("打出攻击牌会推进教学步骤（跳过动画也照常推进）", () => {
    const run = useRunStore();
    run.startRun("bloodwright", 5);
    const store = useBattleStore();
    const tutorial = useTutorialStore();
    tutorial.begin();
    const stage = TUTORIAL_STAGES[0];
    store.startTutorial({ stageId: stage.id, seed: stage.seed, enemies: stage.enemies });
    store.skip();
    const battle = store.battle!;
    const attackIndex = battle.piles.hand.findIndex(
      (id) => loadGameContent().content.cards.get(battle.cardInstances[id].cardId)?.type === "attack",
    );
    expect(attackIndex).toBeGreaterThanOrEqual(0);
    store.selectCard(attackIndex);
    store.skip();
    expect(tutorial.stepIndex).toBe(1);
  });

  it("非战斗节点不再走 run.start（教学不受地图状态影响）", () => {
    const run = useRunStore();
    run.startRun("engineer", 9);
    const store = useBattleStore();
    const tutorial = useTutorialStore();
    // 从设置页重进教学：就算 run 停在地图上，也能直接开教学战斗
    tutorial.begin();
    store.startTutorial({ stageId: "basics", seed: 7, enemies: ["rust_hound"] });
    expect(store.battle).not.toBeNull();
    expect(run.run?.seed).toBe(9);
  });
});
