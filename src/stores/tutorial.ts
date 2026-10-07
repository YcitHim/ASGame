/**
 * stores/tutorial · 「第一班岗」状态机（docs/42）
 *
 * 职责：走到第几章 / 第几步、判定玩家是否做对、免死后兜底、按职业记录。
 * 战斗本身仍走 battle store（教学战斗不写 run 进度）；旁白与判定都只读事件流。
 */
import { defineStore } from "pinia";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import {
  TUTORIAL_CHAPTERS,
  chapterSteps,
  tutorialChapter,
  type TutorialMapChapter,
  type TutorialRewardChapter,
  type TutorialStep,
} from "@/ui/tutorial";

/** 教学局内的微型远征状态（战斗之间要带过去） */
export interface TutorialRunState {
  readonly classId: string;
  hp: number;
  maxHp: number;
  /** 卡组（含幕间 A 拿到的牌与篝火升级） */
  deck: { cardId: string; upgraded: boolean }[];
  /** 已结章的章 id */
  cleared: string[];
}

export const useTutorialStore = defineStore("tutorial", {
  state: () => ({
    /** 教学进行中（battle store 据此走教学战斗） */
    active: false,
    chapterIndex: 0,
    stepIndex: 0,
    /** 全部走完（结业页据此显示） */
    finished: false,
    /** 本局（微型远征）状态；begin() 时按职业初始化 */
    run: null as TutorialRunState | null,
    /** 严判定失败的纠正话术（显示在提示带里，不推进） */
    correction: "",
    /** 免死已触发次数（docs/42 §四：第 2 次改为补满并继续） */
    safetySaves: 0,
    /** 幕间 B：选了篝火，等玩家二选一 */
    restChoiceOpen: false,
  }),
  getters: {
    chapter: (state) => tutorialChapter(state.chapterIndex),
    total(): number {
      return TUTORIAL_CHAPTERS.length;
    },
    classId(state): string {
      return state.run?.classId ?? "bloodwright";
    },
    /** 当前战斗章的完整步骤（含职业追加段） */
    steps(state): readonly TutorialStep[] {
      return chapterSteps(tutorialChapter(state.chapterIndex), state.run?.classId ?? "bloodwright");
    },
    step(state): TutorialStep | undefined {
      return chapterSteps(tutorialChapter(state.chapterIndex), state.run?.classId ?? "bloodwright")[
        state.stepIndex
      ];
    },
    /** 本章步骤是否已全部走完 */
    stepsDone(state): boolean {
      const steps = chapterSteps(tutorialChapter(state.chapterIndex), state.run?.classId ?? "bloodwright");
      if (steps.length === 0) return true;
      return state.stepIndex >= steps.length - 1 && (state.run?.cleared.includes(tutorialChapter(state.chapterIndex)?.id ?? "") ?? false);
    },
    highlightType(): string | null {
      if (!this.active) return null;
      return this.step?.highlightType ?? null;
    },
    highlightCardId(): string | null {
      if (!this.active) return null;
      return this.step?.highlightCardId ?? null;
    },
    isBattleChapter(state): boolean {
      return tutorialChapter(state.chapterIndex)?.kind === "battle";
    },
    stepCount(state): number {
      return chapterSteps(tutorialChapter(state.chapterIndex), state.run?.classId ?? "bloodwright").length;
    },
    /** 奖励幕间的候选（按职业） */
    rewardOffers(state): readonly string[] {
      const chapter = tutorialChapter(state.chapterIndex);
      if (chapter?.kind !== "reward") return [];
      return chapter.offers[state.run?.classId ?? "bloodwright"] ?? [];
    },
  },
  actions: {
    /** 进入「第一班岗」。skipLessons=true 时只补机制课（换职业再玩时用，docs/42 §三.0）。 */
    begin(skipLessons = false): void {
      const run = useRunStore();
      const classId = run.run?.classId ?? "bloodwright";
      const cls = run.classDef;
      this.active = true;
      this.finished = false;
      this.correction = "";
      this.safetySaves = 0;
      this.restChoiceOpen = false;
      this.stepIndex = 0;
      this.chapterIndex = 0;
      this.run = {
        classId,
        hp: cls?.player.maxHp ?? 66,
        maxHp: cls?.player.maxHp ?? 66,
        deck: (cls?.startDeck ?? ["strike", "defend"]).map((cardId) => ({ cardId, upgraded: false })),
        cleared: [],
      };
      if (skipLessons) {
        const index = TUTORIAL_CHAPTERS.findIndex((c) => c.id === "lesson3");
        if (index >= 0) this.chapterIndex = index;
      }
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

    /* ---------- 战斗事件信号（battle store 转发） ---------- */

    noteCardPlayed(cardId: string, cardType: string, energyAfter: number): void {
      const step = this.step;
      if (!this.active || !step) return;
      const goal = step.goal;
      let ok: boolean | null = null;
      if (goal.kind === "playCardId") ok = goal.cardId === cardId;
      else if (goal.kind === "playType") ok = goal.cardType === cardType;
      else if (goal.kind === "energyEmpty") ok = energyAfter === 0;
      if (ok === true) this._advance();
    },

    noteEndTurn(state: { energy: number; block: number; playable: number }): void {
      const step = this.step;
      if (!this.active || !step) return;
      const goal = step.goal;
      let ok: boolean | null = null;
      if (goal.kind === "endTurn") ok = true;
      else if (goal.kind === "blockEndTurn") ok = state.block >= goal.min;
      else if (goal.kind === "spendAll") ok = state.energy === 0 || state.playable === 0;
      if (ok === true) this._advance();
      else if (ok === false && step.strict && step.correct) this.correction = step.correct;
    },

    /** 敌人蓄力重击落地，玩家还活着。 */
    noteSurvivedRelease(): void {
      const step = this.step;
      if (!this.active || !step) return;
      if (step.goal.kind === "survivedRelease") this._advance();
    },

    /** 清场（击杀目标敌人）。 */
    noteCleared(): void {
      const step = this.step;
      if (!this.active || !step) return;
      if (step.goal.kind === "killAll") this._advance();
    },

    /** 安全网触发（docs/42 §四）：返回本次是第几次。 */
    noteSafetyNet(): number {
      this.safetySaves += 1;
      return this.safetySaves;
    },

    /* ---------- 章间流转 ---------- */

    /** 进入下一章；返回 false 表示教学结束。 */
    nextChapter(): boolean {
      this.correction = "";
      this.stepIndex = 0;
      this.restChoiceOpen = false;
      this.safetySaves = 0;
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

    /** 幕间 A：拿走一张牌进卡组。 */
    takeReward(cardId: string): void {
      if (this.run) this.run.deck = [...this.run.deck, { cardId, upgraded: false }];
    },

    /** 幕间 B：选路。篝火打开二选一，其余直接进下一章。 */
    chooseMapNode(nodeId: string): void {
      const chapter = this.chapter;
      if (chapter?.kind !== "map") return;
      if (nodeId === "rest") {
        this.restChoiceOpen = true;
        return;
      }
      this.nextChapter();
    },

    /** 幕间 B 篝火：回血。 */
    restHeal(): void {
      if (this.run) this.run.hp = Math.min(this.run.maxHp, this.run.hp + Math.round(this.run.maxHp * 0.3));
      this.nextChapter();
    },

    /** 幕间 B 篝火：升级一张牌。 */
    restUpgrade(): void {
      if (this.run) {
        const index = this.run.deck.findIndex((c) => !c.upgraded);
        if (index >= 0) {
          this.run.deck = this.run.deck.map((c, i) => (i === index ? { ...c, upgraded: true } : c));
        }
      }
      this.nextChapter();
    },

    /** 跳过 / 退出（不给奖励、不算完成）。 */
    abort(): void {
      this.active = false;
      this.finished = false;
      this.chapterIndex = 0;
      this.stepIndex = 0;
      this.run = null;
      this.correction = "";
      this.restChoiceOpen = false;
    },
  },
});

export type { TutorialMapChapter, TutorialRewardChapter };
