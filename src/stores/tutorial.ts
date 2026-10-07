/**
 * stores/tutorial · 「第一班岗」状态机（docs/42，速成版）
 *
 * 只做四件事：走到第几步、这一步算不算做完、敌人挂异常了没有、教学局的血与牌。
 * 幕间（奖励 / 地图）已按甲方要求砍掉——教学就是一场战斗，打完即走。
 */
import { defineStore } from "pinia";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import { TUTORIAL_CHAPTERS, chapterSteps, tutorialChapter, type TutorialStep } from "@/ui/tutorial";

/** 教学局状态（跨步骤带着走） */
export interface TutorialRunState {
  readonly classId: string;
  hp: number;
  maxHp: number;
  deck: { cardId: string; upgraded: boolean }[];
  cleared: string[];
}

export const useTutorialStore = defineStore("tutorial", {
  state: () => ({
    active: false,
    chapterIndex: 0,
    stepIndex: 0,
    finished: false,
    run: null as TutorialRunState | null,
    /** 严判定失败的纠正话术（显示在提示带里，不推进） */
    correction: "",
    /** 免死已触发次数（docs/42 §四：第二次补满并继续） */
    safetySaves: 0,
    /** 敌人已经给玩家挂过异常（用于 playerDebuffed 判定） */
    debuffed: false,
  }),
  getters: {
    chapter: (state) => tutorialChapter(state.chapterIndex),
    total(): number {
      return TUTORIAL_CHAPTERS.length;
    },
    steps(state): readonly TutorialStep[] {
      return chapterSteps(tutorialChapter(state.chapterIndex));
    },
    step(state): TutorialStep | undefined {
      return chapterSteps(tutorialChapter(state.chapterIndex))[state.stepIndex];
    },
    stepCount(state): number {
      return chapterSteps(tutorialChapter(state.chapterIndex)).length;
    },
    /** 这一步要高亮屏幕上的哪一块 */
    focus(): string | null {
      if (!this.active) return null;
      return this.step?.focus ?? null;
    },
    highlightType(): string | null {
      if (!this.active) return null;
      return this.step?.highlightType ?? null;
    },
    highlightCardId(): string | null {
      if (!this.active) return null;
      return this.step?.highlightCardId ?? null;
    },
    /** 当前步骤的「知道了」按钮：只有导览步（acknowledge）才有 */
    needsAcknowledge(): boolean {
      return this.active && this.step?.goal.kind === "acknowledge";
    },
    isBattleChapter(state): boolean {
      return tutorialChapter(state.chapterIndex)?.kind === "battle";
    },
    /** 当前步骤要发的保底牌（grant + 按职业的 classGrant） */
    stepGrant(state): readonly string[] {
      const step = chapterSteps(tutorialChapter(state.chapterIndex))[state.stepIndex];
      if (!step) return [];
      const byClass = step.classGrant?.[state.run?.classId ?? "bloodwright"] ?? [];
      return [...(step.grant ?? []), ...byClass];
    },
  },
  actions: {
    /** 进入「第一班岗」。 */
    begin(): void {
      const run = useRunStore();
      const classId = run.run?.classId ?? "bloodwright";
      const cls = run.classDef;
      this.active = true;
      this.finished = false;
      this.chapterIndex = 0;
      this.stepIndex = 0;
      this.correction = "";
      this.safetySaves = 0;
      this.debuffed = false;
      this.run = {
        classId,
        hp: cls?.player.maxHp ?? 66,
        maxHp: cls?.player.maxHp ?? 66,
        deck: (cls?.startDeck ?? ["strike", "defend"]).map((cardId) => ({ cardId, upgraded: false })),
        cleared: [],
      };
      useMetaStore().markTutorialOffered(classId);
    },

    _advance(): void {
      this.correction = "";
      const steps = this.steps;
      if (this.stepIndex + 1 < steps.length) {
        this.stepIndex += 1;
        return;
      }
      const id = this.chapter?.id;
      if (id && this.run && !this.run.cleared.includes(id)) this.run.cleared = [...this.run.cleared, id];
    },

    /* ---------- 判定信号（battle store / 视图转发） ---------- */

    /** 导览步：玩家点了「知道了」。 */
    noteAcknowledge(): void {
      const step = this.step;
      if (!this.active || !step) return;
      if (step.goal.kind === "acknowledge") this._advance();
    },

    noteCardPlayed(cardId: string, cardType: string): void {
      const step = this.step;
      if (!this.active || !step) return;
      const goal = step.goal;
      let ok: boolean | null = null;
      if (goal.kind === "playCardId") ok = goal.cardId === cardId;
      else if (goal.kind === "playType") ok = goal.cardType === cardType;
      if (ok === true) this._advance();
    },

    noteEndTurn(state: { block: number }): void {
      const step = this.step;
      if (!this.active || !step) return;
      const goal = step.goal;
      if (goal.kind !== "blockEndTurn") return;
      if (state.block >= goal.min) this._advance();
      else if (step.strict) this.correction = step.correct ?? `这一步还没做完——${step.how}`;
    },

    /** 敌人给玩家挂了异常（污染 / 虚弱 / 易伤…）。 */
    notePlayerDebuffed(): void {
      this.debuffed = true;
      const step = this.step;
      if (!this.active || !step) return;
      if (step.goal.kind === "playerDebuffed") this._advance();
    },

    noteCleared(): void {
      const step = this.step;
      if (!this.active || !step) return;
      if (step.goal.kind === "killAll") this._advance();
    },

    noteSafetyNet(): number {
      this.safetySaves += 1;
      return this.safetySaves;
    },

    /* ---------- 章间流转 ---------- */

    /** 进入下一章；返回 false 表示教学结束。 */
    nextChapter(): boolean {
      this.correction = "";
      this.stepIndex = 0;
      this.safetySaves = 0;
      this.debuffed = false;
      const index = this.chapterIndex + 1;
      if (index >= TUTORIAL_CHAPTERS.length) {
        this.finished = true;
        this.active = false;
        useMetaStore().markTutorialDone(this.run?.classId ?? "bloodwright");
        return false;
      }
      this.chapterIndex = index;
      return true;
    },

    /** 跳过 / 退出（不算完成）。 */
    abort(): void {
      this.active = false;
      this.finished = false;
      this.chapterIndex = 0;
      this.stepIndex = 0;
      this.run = null;
      this.correction = "";
      this.debuffed = false;
    },
  },
});
