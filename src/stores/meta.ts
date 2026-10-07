/**
 * stores/meta · 局外解锁与成就（docs/16 5.3 / 6.1，docs/36 T1，docs/38 §三 C-3）
 *
 * 记录：通关过的职业、已解锁内容 id、成就墙、每职业最佳纪录。
 * 内容是否入池由 core 依 unlockCondition + 这份 id 列表判定（core 不依赖 UI 层）。
 * 铁律：全部奖励 = 内容解锁或纪录，禁永久数值成长。
 */
import { defineStore } from "pinia";
import { useSettingsStore } from "@/stores/settings";
import { readSlot, writeSlot } from "@/systems/save";

/** 开发者模式：解锁全部局外内容（测试跳关用）。 */
function devMode(): boolean {
  return useSettingsStore().values.developerMode;
}

/** 成就墙首批 12 条（docs/38 §三 C-3）+ 「引路人」（docs/41 §4.3 教学）。 */
export const ACHIEVEMENT_IDS = [
  "clear_bloodwright",
  "clear_engineer",
  "clear_rustspeaker",
  "all_classes_clear",
  "no_bloodpact_clear",
  "overload3_clear",
  "pollution99_end",
  "interrupt10",
  "enhance3",
  "backlash3_win",
  "rust_clear",
  "codex_all",
  "guide",
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export interface RunRecord {
  /** 最少回合通关 */
  minTurns: number | null;
  /** 最高剩余 HP 通关 */
  maxHp: number | null;
}

interface MetaState {
  clearedClasses: string[];
  unlocked: string[];
  achievements: string[];
  records: Record<string, RunRecord>;
  /** 跨局累计统计（成就判定用）：累计断链次数 */
  stats: { interrupts: number };
  /** 首遇提示已读记录（docs/41 §4.1）：跨局不再重复弹 */
  tips: string[];
  /** 教学：已问过「第一班岗」的职业（docs/42 §三.0，按职业记录） */
  tutorialOffered: string[];
  /** 教学：已走完「第一班岗」的职业 */
  tutorialDone: string[];
}

/** 一次远征的成就输入（由 run store 汇总）。 */
export interface RunAchievements {
  readonly classId: string;
  /** 本局是否打出过任何血契卡 */
  readonly usedBloodpact: boolean;
  /** 本局触发过载反噬的次数 */
  readonly overloadCount: number;
  /** 本局断链次数（docs/38 §三 C-1） */
  readonly interrupts?: number;
  /** 本局承受反噬总次数（过载 + 污染满值） */
  readonly backlashTaken?: number;
  /** 本局累计战斗回合 */
  readonly turns?: number;
  /** 本局污染峰值 */
  readonly pollutionPeak?: number;
  /** 本局附着强化枚数 */
  readonly enhancementsAttached?: number;
  /** 本局难度 */
  readonly difficulty?: string;
  /** 通关时图鉴是否已全收录 */
  readonly codexComplete?: boolean;
  /** 通关时剩余 HP（最佳纪录用） */
  readonly hpLeft?: number;
  /** 是否胜利（只有胜利才记成就与纪录） */
  readonly won?: boolean;
}

export const useMetaStore = defineStore("meta", {
  state: () => ({
    clearedClasses: [] as string[],
    unlocked: [] as string[],
    achievements: [] as string[],
    records: {} as Record<string, RunRecord>,
    stats: { interrupts: 0 },
    /** 首遇提示已读（docs/41 §4.1） */
    tips: [] as string[],
    /** 教学：每个职业首次选择时问一次是否要带路（docs/42 §三.0） */
    tutorialOffered: [] as string[],
    /** 教学：走完「第一班岗」的职业（解锁「引路人」徽章） */
    tutorialDone: [] as string[],
    /** 最近一次通关新解锁的内容 id（结算页弹提示用） */
    lastUnlocked: [] as string[],
    /** 最近一次通关新达成的成就 id（结算页弹提示用） */
    lastAchievements: [] as string[],
    loaded: false,
  }),
  getters: {
    hasCleared: (state) => (classId: string) => state.clearedClasses.includes(classId),
    /** 职业解锁判定：unlock 缺省 / default = 初始可用；first_boss_clear = 任一职业通关一次。 */
    isUnlocked: (state) => (unlock: string | undefined) => {
      if (devMode()) return true;
      if (!unlock || unlock === "default" || unlock === "none") return true;
      if (unlock === "first_boss_clear") return state.clearedClasses.length > 0;
      // 第三职业（docs/38 §二 B-1）：血械 + 炉心各通关一次
      if (unlock === "both_classes_clear") {
        return state.clearedClasses.includes("bloodwright") && state.clearedClasses.includes("engineer");
      }
      return state.clearedClasses.length > 0;
    },
    /** 内容（卡/遗物）是否已解锁。 */
    isContentUnlocked: (state) => (id: string | undefined) => devMode() || !id || state.unlocked.includes(id),
    /** 锈蚀难度是否解锁（通关一次）。 */
    rustUnlocked: (state) => devMode() || state.clearedClasses.length > 0,
    isAchieved: (state) => (id: string) => state.achievements.includes(id),
    recordOf: (state) => (classId: string) =>
      state.records[classId] ?? { minTurns: null, maxHp: null },
  },
  actions: {
    ensureLoaded(): void {
      if (this.loaded) return;
      const saved = readSlot<MetaState | null>("meta", null);
      if (saved) {
        this.clearedClasses = saved.clearedClasses ?? [];
        this.unlocked = saved.unlocked ?? [];
        this.achievements = saved.achievements ?? [];
        this.records = saved.records ?? {};
        this.stats = { interrupts: saved.stats?.interrupts ?? 0 };
        this.tips = saved.tips ?? [];
        this.tutorialOffered = Array.isArray(saved.tutorialOffered) ? saved.tutorialOffered : [];
        this.tutorialDone = Array.isArray(saved.tutorialDone) ? saved.tutorialDone : [];
      }
      this.loaded = true;
    },
    persist(): void {
      writeSlot("meta", {
        clearedClasses: [...this.clearedClasses],
        unlocked: [...this.unlocked],
        achievements: [...this.achievements],
        records: { ...this.records },
        stats: { ...this.stats },
        tips: [...this.tips],
        tutorialOffered: [...this.tutorialOffered],
        tutorialDone: [...this.tutorialDone],
      } satisfies MetaState);
    },
    unlock(ids: readonly string[]): string[] {
      this.ensureLoaded();
      const gained: string[] = [];
      const next = new Set(this.unlocked);
      for (const id of ids) {
        if (next.has(id)) continue;
        next.add(id);
        gained.push(id);
      }
      if (gained.length > 0) {
        this.unlocked = [...next];
        this.persist();
      }
      return gained;
    },
    markCleared(classId: string): void {
      this.ensureLoaded();
      if (!this.clearedClasses.includes(classId)) {
        this.clearedClasses = [...this.clearedClasses, classId];
        this.persist();
      }
    },
    /** 首遇提示是否已读（docs/41 §4.1）。 */
    hasSeenTip(id: string): boolean {
      this.ensureLoaded();
      return this.tips.includes(id);
    },

    markTipSeen(id: string): void {
      this.ensureLoaded();
      if (this.tips.includes(id)) return;
      this.tips = [...this.tips, id];
      this.persist();
    },

    /** 教学：记下"这个职业已经问过要不要带路"，之后不再问（docs/42 §三.0）。 */
    markTutorialOffered(classId: string): void {
      this.ensureLoaded();
      if (this.tutorialOffered.includes(classId)) return;
      this.tutorialOffered = [...this.tutorialOffered, classId];
      this.persist();
    },

    /** 这个职业是否已经问过是否要带路（已走完也算问过）。 */
    wasTutorialOffered(classId: string): boolean {
      return this.tutorialOffered.includes(classId) || this.tutorialDone.includes(classId);
    },

    /** 这个职业是否已走完「第一班岗」。 */
    hasDoneTutorial(classId: string): boolean {
      return this.tutorialDone.includes(classId);
    },

    /** 教学走完（按职业记）：解锁图鉴「引路人」徽章（不给任何数值/内容奖励）。 */
    markTutorialDone(classId: string): void {
      this.ensureLoaded();
      if (!this.tutorialDone.includes(classId)) this.tutorialDone = [...this.tutorialDone, classId];
      if (!this.achievements.includes("guide")) this.achievements = [...this.achievements, "guide"];
      this.persist();
    },

    /** 图鉴页「重新显示一遍」。 */
    resetTips(): void {
      this.ensureLoaded();
      this.tips = [];
      this.persist();
    },

    /** 记录达成成就，返回本次新达成项。 */
    achieve(ids: readonly string[]): string[] {
      this.ensureLoaded();
      const gained: string[] = [];
      const next = new Set(this.achievements);
      for (const id of ids) {
        if (next.has(id)) continue;
        next.add(id);
        gained.push(id);
      }
      if (gained.length > 0) {
        this.achievements = [...next];
        this.persist();
      }
      return gained;
    },
    /** 累计断链次数（成就「打断施法者」跨局累计，docs/38 §三 C-3）。 */
    addInterruptStat(n = 1): void {
      this.ensureLoaded();
      this.stats = { ...this.stats, interrupts: this.stats.interrupts + Math.max(0, n) };
      this.persist();
    },
    /** 更新某职业最佳纪录（只在更优时写入）。 */
    updateRecord(classId: string, turns: number, hpLeft: number): void {
      this.ensureLoaded();
      const prev = this.records[classId] ?? { minTurns: null, maxHp: null };
      const next: RunRecord = {
        minTurns: prev.minTurns == null ? turns : Math.min(prev.minTurns, turns),
        maxHp: prev.maxHp == null ? hpLeft : Math.max(prev.maxHp, hpLeft),
      };
      this.records = { ...this.records, [classId]: next };
      this.persist();
    },
    /**
     * 通关结算（docs/36 T1 内容解锁 + docs/38 §三 C-3 成就与纪录）：
     * 返回本次新解锁的内容 id；成就写入 lastAchievements。
     */
    evaluateRun(ach: RunAchievements): string[] {
      this.ensureLoaded();
      if (this.clearedClasses.length === 0) return [];
      // —— 内容解锁（docs/36 T1 / docs/38 §一.4）
      const ids: string[] = ["bloodrust"];
      if (this.hasCleared("engineer")) ids.push("ember_core");
      if (!ach.usedBloodpact) ids.push("immortality");
      if (ach.overloadCount >= 3) ids.push("redlineprotocol");
      if (this.clearedClasses.length >= 3) ids.push("pilgrim_bell");
      const gained = this.unlock(ids);
      this.lastUnlocked = gained;

      // —— 成就（只有胜利才计入）
      if (ach.won !== false) {
        const achieved: AchievementId[] = [`clear_${ach.classId}` as AchievementId];
        if (this.clearedClasses.length >= 3) achieved.push("all_classes_clear");
        if (!ach.usedBloodpact) achieved.push("no_bloodpact_clear");
        if (ach.overloadCount >= 3) achieved.push("overload3_clear");
        if ((ach.pollutionPeak ?? 0) >= 99) achieved.push("pollution99_end");
        if (this.stats.interrupts >= 10) achieved.push("interrupt10");
        if ((ach.enhancementsAttached ?? 0) >= 3) achieved.push("enhance3");
        if ((ach.backlashTaken ?? 0) >= 3) achieved.push("backlash3_win");
        if (ach.difficulty === "rust") achieved.push("rust_clear");
        if (ach.codexComplete) achieved.push("codex_all");
        this.lastAchievements = this.achieve(achieved);
        if (ach.turns !== undefined && ach.hpLeft !== undefined) {
          this.updateRecord(ach.classId, ach.turns, ach.hpLeft);
        }
      } else {
        this.lastAchievements = [];
      }
      return gained;
    },
    clearLastUnlocked(): void {
      this.lastUnlocked = [];
    },
    clearLastAchievements(): void {
      this.lastAchievements = [];
    },
    clear(): void {
      this.clearedClasses = [];
      this.unlocked = [];
      this.achievements = [];
      this.records = {};
      this.stats = { interrupts: 0 };
      this.lastUnlocked = [];
      this.lastAchievements = [];
      this.persist();
    },
  },
});
