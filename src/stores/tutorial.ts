/**
 * stores/tutorial · 「第一班岗」状态机（docs/42，速成版）
 *
 * 只做四件事：走到第几步、这一步算不算做完、敌人挂异常了没有、教学局的血与牌。
 * 幕间（奖励 / 地图）已按甲方要求砍掉——教学就是一场战斗，打完即走。
 */
import { defineStore } from "pinia";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import {
  TUTORIAL_CHAPTERS,
  chapterSteps,
  tutorialChapter,
  type TutorialIntentScript,
  type TutorialStep,
} from "@/ui/tutorial";

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
    /** 当前步骤的判定已满足，但这一步要求玩家点「知道了」才翻页（step.ack） */
    stepDone: false,
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
    /**
     * 当前步骤的「知道了」按钮：
     * - 导览步（acknowledge）永远有；
     * - 标了 ack 的判定步，做到之后也会亮出来（让玩家停一下再走）。
     */
    needsAcknowledge(): boolean {
      if (!this.active || !this.step) return false;
      return this.step.goal.kind === "acknowledge" || (this.step.ack === true && this.stepDone);
    },
    isBattleChapter(state): boolean {
      return tutorialChapter(state.chapterIndex)?.kind === "battle";
    },
    /** 当前步骤要钉的敌人意图（教学脚本，见 TutorialIntentScript） */
    stepIntent(state): TutorialIntentScript | null {
      const step = chapterSteps(tutorialChapter(state.chapterIndex))[state.stepIndex];
      return step?.intent ?? null;
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
      this.stepDone = false;
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
      this._persist();
    },

    /**
     * 断点续做（docs/43 Q2）：把存档里的进度搬回状态机。
     * 返回 false = 没有未完成的教学。
     */
    resume(): boolean {
      const meta = useMetaStore();
      meta.ensureLoaded();
      const saved = meta.tutorial;
      if (!saved) return false;
      this.active = true;
      this.finished = false;
      this.chapterIndex = saved.chapterIndex;
      this.stepIndex = saved.stepIndex;
      this.correction = "";
      this.stepDone = false;
      this.safetySaves = 0;
      this.debuffed = false;
      this.run = {
        classId: saved.classId,
        hp: saved.hp,
        maxHp: saved.maxHp,
        deck: saved.deck.map((card) => ({ ...card })),
        cleared: [...saved.cleared],
      };
      return true;
    },

    /** 把当前进度写回 meta 档；教学已结束（或没开始）就清空断点。 */
    _persist(): void {
      const meta = useMetaStore();
      if (!this.active || !this.run) {
        meta.setTutorialProgress(null);
        return;
      }
      meta.setTutorialProgress({
        classId: this.run.classId,
        chapterIndex: this.chapterIndex,
        stepIndex: this.stepIndex,
        hp: this.run.hp,
        maxHp: this.run.maxHp,
        deck: this.run.deck.map((card) => ({ ...card })),
        cleared: [...this.run.cleared],
      });
    },

    /** 判定满足：普通步骤直接翻页；标了 ack 的步骤停下来等「知道了」。 */
    _satisfy(): void {
      const step = this.step;
      if (!step) return;
      this.correction = "";
      if (step.ack === true) {
        this.stepDone = true;
        return;
      }
      this._advance();
    },

    /**
     * 进入新步骤时的"已经满足"兜底：
     * 玩家可能在上一课就把异常吃到了（比如提前结束回合），那一课不该卡死。
     */
    _checkPreSatisfied(): void {
      const step = this.step;
      if (!step) return;
      if (step.goal.kind === "playerDebuffed" && this.debuffed) {
        if (step.ack === true) this.stepDone = true;
        else this._advance();
      }
    },

    _advance(): void {
      this.correction = "";
      this.stepDone = false;
      const steps = this.steps;
      if (this.stepIndex + 1 < steps.length) {
        this.stepIndex += 1;
        this._persist();
        this._checkPreSatisfied();
        return;
      }
      const id = this.chapter?.id;
      if (id && this.run && !this.run.cleared.includes(id)) this.run.cleared = [...this.run.cleared, id];
      this._persist();
    },

    /* ---------- 判定信号（battle store / 视图转发） ---------- */

    /** 「知道了」：导览步直接翻页；标了 ack 的判定步在做到之后也用它翻页。 */
    noteAcknowledge(): void {
      const step = this.step;
      if (!this.active || !step) return;
      if (step.goal.kind === "acknowledge" || (step.ack === true && this.stepDone)) this._advance();
    },

    noteCardPlayed(cardId: string, cardType: string): void {
      const step = this.step;
      if (!this.active || !step) return;
      const goal = step.goal;
      let ok: boolean | null = null;
      if (goal.kind === "playCardId") ok = goal.cardId === cardId;
      else if (goal.kind === "playType") ok = goal.cardType === cardType;
      if (ok === true) this._satisfy();
    },

    noteEndTurn(state: { block: number }): void {
      const step = this.step;
      if (!this.active || !step) return;
      const goal = step.goal;
      if (goal.kind !== "blockEndTurn") return;
      if (state.block >= goal.min) this._satisfy();
      else if (step.strict) this.correction = step.correct ?? `这一步还没做完——${step.how}`;
    },

    /** 敌人给玩家挂了异常（污染 / 虚弱 / 易伤…）。 */
    notePlayerDebuffed(): void {
      this.debuffed = true;
      const step = this.step;
      if (!this.active || !step) return;
      if (step.goal.kind === "playerDebuffed") this._satisfy();
    },

    noteCleared(): void {
      const step = this.step;
      if (!this.active || !step) return;
      if (step.goal.kind === "killAll") this._satisfy();
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
      this.stepDone = false;
      this.safetySaves = 0;
      this.debuffed = false;
      const index = this.chapterIndex + 1;
      if (index >= TUTORIAL_CHAPTERS.length) {
        this.finished = true;
        this.active = false;
        useMetaStore().markTutorialDone(this.run?.classId ?? "bloodwright");
        this._persist();
        return false;
      }
      this.chapterIndex = index;
      this._persist();
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
      this.stepDone = false;
      this.debuffed = false;
      this._persist();
    },
  },
});
