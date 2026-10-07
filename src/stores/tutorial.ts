/**
 * stores/tutorial · 教学遭遇战的运行期状态（docs/41 §4.3）
 *
 * 只管：进到第几场、第几步、完成了没有。战斗本身仍走 battle store，
 * 只是那场战斗不挂 run 进度（见 battle store 的 tutorialConfig）。
 */
import { defineStore } from "pinia";
import { TUTORIAL_STAGES, tutorialStage, type TutorialStep } from "@/ui/tutorial";
import { useMetaStore } from "@/stores/meta";

export const useTutorialStore = defineStore("tutorial", {
  state: () => ({
    /** 教学进行中（决定 battle store 是否走教学战斗） */
    active: false,
    stageIndex: 0,
    stepIndex: 0,
    /** 全部三场走完 */
    finished: false,
  }),
  getters: {
    stage: (state) => tutorialStage(state.stageIndex),
    step(state): TutorialStep | undefined {
      return tutorialStage(state.stageIndex)?.steps[state.stepIndex];
    },
    total(): number {
      return TUTORIAL_STAGES.length;
    },
    highlightType(): string | null {
      if (!this.active) return null;
      return this.step?.highlightType ?? null;
    },
  },
  actions: {
    /** 进入教学（首页「要人带路吗？」选是，或设置页重看）。 */
    begin(): void {
      this.active = true;
      this.stageIndex = 0;
      this.stepIndex = 0;
      this.finished = false;
      useMetaStore().markTutorialOffered();
    },
    /** 玩家操作正确 → 推进到下一步；本场走完返回 true。 */
    notePlay(cardType: string): void {
      this._match({ kind: "playType", cardType });
    },
    noteEndTurn(): void {
      this._match({ kind: "endTurn" });
    },
    _match(done: TutorialStep["done"]): void {
      const step = this.step;
      if (!this.active || !step) return;
      if (step.done.kind !== done.kind) return;
      if (done.kind === "playType" && step.done.kind === "playType" && step.done.cardType !== done.cardType) {
        return;
      }
      const stages = this.stage;
      if (!stages) return;
      if (this.stepIndex + 1 < stages.steps.length) this.stepIndex += 1;
    },
    /** 一场打完：还有下一场就换场，三场都完就收尾（图鉴解锁「引路人」）。 */
    completeStage(): "next" | "done" {
      if (this.stageIndex + 1 < TUTORIAL_STAGES.length) {
        this.stageIndex += 1;
        this.stepIndex = 0;
        return "next";
      }
      this.active = false;
      this.finished = true;
      useMetaStore().markTutorialDone();
      return "done";
    },
    /** 跳过 / 退出教学：不给任何奖励，也不算完成。 */
    abort(): void {
      this.active = false;
      this.stepIndex = 0;
      this.stageIndex = 0;
    },
  },
});
