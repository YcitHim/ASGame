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
  /** 进阶教学徽章（docs/43 Q6）：三职业第一班岗全部走完 */
  "three_watch",
] as const;

/** 教学覆盖的三个职业（docs/43 Q6「三朝守夜」的判定口径）。 */
export const TUTORIAL_CLASSES = ["bloodwright", "engineer", "rustspeaker"] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/**
 * 进行中的「第一班岗」（docs/43 Q2）：关掉游戏也能接着上工。
 * 只存教学局自己的簿记——它和远征进度无关，所以不写 progress 槽。
 */
export interface TutorialProgress {
  readonly classId: string;
  chapterIndex: number;
  stepIndex: number;
  hp: number;
  maxHp: number;
  deck: { cardId: string; upgraded: boolean }[];
  cleared: string[];
}

export interface RunRecord {
  /** 最少回合通关 */
  minTurns: number | null;
  /** 最高剩余 HP 通关 */
  maxHp: number | null;
  /**
   * 完成日期（ISO `YYYY-MM-DD`，甲方 2026-10-08「完成时间改为日期」）。
   * 取**首次达成该纪录**那天的日期；与另两项一样是「独立最好值」，
   * 只在对应项被刷新时才改写——旧档没有这一项，缺省就不写这个键。
   */
  date?: string | null;
}

/** 「无特性」在纪录键里的占位（docs/58：无特性 = 现版玩法，也是基线对照组）。 */
export const NO_TRAIT_KEY = "none";

/**
 * 纪录键 = 职业 + 难度 + 特性（甲方 2026-10-08）：
 *  - 普通 / 锈蚀**分开记两个榜**，互不覆盖；
 *  - 同一职业下**每个特性各记一条**（工程师的铁皮王八 / 玻璃大炮 / 无特性互不覆盖）。
 *
 * 兼容旧档：旧纪录键只有 `职业:难度`（特性系统上线前）——`ensureLoaded` 迁移时按
 * 「无特性」补上 `:none` 段；再早的旧档只有职业名，先补难度再补特性。
 * 注意分隔符是 `:`，卡池 id 里不含冒号，所以 `split(":")` 切分是安全的。
 */
export function recordKey(classId: string, difficulty: string | undefined, traitId?: string): string {
  const diff = difficulty === "rust" ? "rust" : "normal";
  const trait = traitId && traitId !== "" ? traitId : NO_TRAIT_KEY;
  return `${classId}:${diff}:${trait}`;
}

/** 拆分纪录键（榜 UI 用）：非法键返回 null，不炸。 */
export function parseRecordKey(key: string): { classId: string; difficulty: string; traitId: string } | null {
  const parts = key.split(":");
  // 兼容两种历史形态：`class`（v0）/ `class:difficulty`（v1）/ `class:difficulty:trait`（现行）
  if (parts.length === 1) return { classId: parts[0], difficulty: "normal", traitId: NO_TRAIT_KEY };
  if (parts.length === 2) {
    return { classId: parts[0], difficulty: parts[1] === "rust" ? "rust" : "normal", traitId: NO_TRAIT_KEY };
  }
  if (parts.length === 3) {
    return { classId: parts[0], difficulty: parts[1] === "rust" ? "rust" : "normal", traitId: parts[2] || NO_TRAIT_KEY };
  }
  return null;
}

/** 一条纪录是否为空（三项全无）。 */
export function isEmptyRecord(rec: RunRecord | undefined): boolean {
  return !rec || (rec.minTurns == null && rec.maxHp == null && rec.date == null);
}

/**
 * 两条纪录取优（用于「某职业×难度下所有特性的总最好一条」）。
 * 口径：先比最少回合（小者优），回合相同再比余血（大者优），再取**更早**的完成日期。
 */
export function betterRecord(a: RunRecord | undefined, b: RunRecord | undefined): RunRecord | undefined {
  if (isEmptyRecord(a)) return isEmptyRecord(b) ? undefined : b;
  if (isEmptyRecord(b)) return a;
  const ra = a as RunRecord;
  const rb = b as RunRecord;
  const ta = ra.minTurns ?? Number.POSITIVE_INFINITY;
  const tb = rb.minTurns ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta < tb ? ra : rb;
  const ha = ra.maxHp ?? Number.NEGATIVE_INFINITY;
  const hb = rb.maxHp ?? Number.NEGATIVE_INFINITY;
  return ha >= hb ? ra : rb;
}

/** 职业×难度下所有特性桶的总最好纪录（标题页/总览）。 */
function bestRecord(records: Record<string, RunRecord>, classId: string, difficulty: string): RunRecord {
  const diff = difficulty === "rust" ? "rust" : "normal";
  let best: RunRecord | undefined;
  for (const [key, rec] of Object.entries(records)) {
    const parsed = parseRecordKey(key);
    if (!parsed || parsed.classId !== classId || parsed.difficulty !== diff) continue;
    best = betterRecord(best, rec);
  }
  return best ?? { minTurns: null, maxHp: null };
}

/**
 * 职业×难度下各特性分档纪录（含 traitId 与是否无特性）。
 * 对外统一用 **空串** 表示「无特性」（内部键里的占位 `none` 在此归一化掉），
 * 免得每个消费方都要自己判 `"none"`。
 */
export function traitRecords(
  records: Record<string, RunRecord>,
  classId: string,
  difficulty: string,
): { traitId: string; record: RunRecord }[] {
  const diff = difficulty === "rust" ? "rust" : "normal";
  const out: { traitId: string; record: RunRecord }[] = [];
  for (const [key, rec] of Object.entries(records)) {
    const parsed = parseRecordKey(key);
    if (!parsed || parsed.classId !== classId || parsed.difficulty !== diff) continue;
    if (isEmptyRecord(rec)) continue;
    out.push({ traitId: parsed.traitId === NO_TRAIT_KEY ? "" : parsed.traitId, record: rec });
  }
  return out;
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
  /** 教学：未走完的进度（断点续做；走完或跳过即清空） */
  tutorial: TutorialProgress | null;
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
  /** 通关那天的日期（ISO `YYYY-MM-DD`；缺省 = 不计日期） */
  readonly date?: string;
  /** 本局所选职业特性（docs/58；空串 = 无特性）——纪录按特性分开记 */
  readonly traitId?: string;
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
    /** 教学：没走完的那一次（docs/43 Q2） */
    tutorial: null as TutorialProgress | null,
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
    /**
     * 取某条纪录。缺省 traitId（未传）→ 返回该职业×难度下**所有特性里最好的一条**
     * （标题页总览用）；显式传 traitId（含空串 = 无特性）→ 只取那一档。
     */
    recordOf: (state) => (classId: string, difficulty: string = "normal", traitId?: string) => {
      if (traitId !== undefined) {
        return state.records[recordKey(classId, difficulty, traitId)] ?? { minTurns: null, maxHp: null };
      }
      return bestRecord(state.records, classId, difficulty);
    },
    /** 某职业×难度下，各特性分档的纪录行（排行榜 UI 用；按战力排序、无纪录的档不列）。 */
    recordsByTrait: (state) => (classId: string, difficulty: string = "normal") => {
      return traitRecords(state.records, classId, difficulty);
    },
  },
  actions: {
    ensureLoaded(): void {
      if (this.loaded) return;
      const saved = readSlot<MetaState | null>("meta", null);
      if (saved) {
        this.clearedClasses = saved.clearedClasses ?? [];
        this.unlocked = saved.unlocked ?? [];
        this.achievements = saved.achievements ?? [];
        // 迁移（甲方 2026-10-08）：旧纪录键逐代归一化到「职业:难度:特性」三段式。
        //  - v0：只有职业名           → 补 `:normal:none`
        //  - v1：`职业:难度`（特性系统上线前）→ 补 `:none`（那时=现版玩法=无特性）
        //  - v2：已是三段式，原样保留
        // 不这样补，旧档的最好成绩会凭空消失；把旧成绩归到「无特性」档也符合史实。
        const migrated: Record<string, RunRecord> = {};
        for (const [key, rec] of Object.entries(saved.records ?? {})) {
          const parsed = parseRecordKey(key);
          migrated[parsed ? recordKey(parsed.classId, parsed.difficulty, parsed.traitId) : key] = rec;
        }
        this.records = migrated;
        this.stats = { interrupts: saved.stats?.interrupts ?? 0 };
        this.tips = saved.tips ?? [];
        this.tutorialOffered = Array.isArray(saved.tutorialOffered) ? saved.tutorialOffered : [];
        this.tutorialDone = Array.isArray(saved.tutorialDone) ? saved.tutorialDone : [];
        this.tutorial = saved.tutorial ?? null;
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
        tutorial: this.tutorial ? { ...this.tutorial, deck: [...this.tutorial.deck], cleared: [...this.tutorial.cleared] } : null,
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
      // 「三朝守夜」（docs/43 Q6）：三职业第一班岗全部走完
      if (TUTORIAL_CLASSES.every((id) => this.tutorialDone.includes(id)) && !this.achievements.includes("three_watch")) {
        this.achievements = [...this.achievements, "three_watch"];
      }
      this.persist();
    },

    /** 记下/清空"进行中的第一班岗"（docs/43 Q2）。 */
    setTutorialProgress(progress: TutorialProgress | null): void {
      this.ensureLoaded();
      this.tutorial = progress;
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
    /**
     * 更新某职业 + 难度 + 特性的最佳纪录（只在更优时写入）。
     * difficulty 缺省 = 普通档；traitId 空串 = 无特性档。
     *
     * 日期口径（「完成时间改为日期」）：只在**该项纪录确实被刷新**时，把日期更新为
     * 本次通关日期；没刷新就保留原日期——这样「最少回合」与「最高余血」各自
     * 记的是达成那一刻的日期，不是最后一次游玩的日期。
     */
    updateRecord(
      classId: string,
      turns: number,
      hpLeft: number,
      difficulty: string = "normal",
      date?: string,
      traitId: string = "",
    ): void {
      this.ensureLoaded();
      const key = recordKey(classId, difficulty, traitId);
      const prev = this.records[key] ?? { minTurns: null, maxHp: null };
      const turnsBetter = prev.minTurns == null || turns < prev.minTurns;
      const hpBetter = prev.maxHp == null || hpLeft > prev.maxHp;
      const improved = turnsBetter || hpBetter;
      const next: RunRecord = {
        minTurns: prev.minTurns == null ? turns : Math.min(prev.minTurns, turns),
        maxHp: prev.maxHp == null ? hpLeft : Math.max(prev.maxHp, hpLeft),
      };
      // 日期只随刷新走：刷新了写本次日期；没带日期（旧调用点/测试）则沿用旧值
      const nextDate = improved ? (date ?? prev.date) : prev.date;
      if (nextDate != null) next.date = nextDate;
      this.records = { ...this.records, [key]: next };
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
      // docs/64 §六.3：engineer_first_clear 的解锁位移交双重钟摆（炉心余烬已下架）
      const ids: string[] = ["bloodrust"];
      if (this.hasCleared("engineer")) ids.push("double_pendulum");
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
          this.updateRecord(ach.classId, ach.turns, ach.hpLeft, ach.difficulty, ach.date, ach.traitId ?? "");
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
      this.tutorial = null;
      this.persist();
    },
  },
});
