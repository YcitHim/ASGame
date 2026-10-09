// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_IDS, useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";

/** docs/38 §三 C-3 · 成就墙与最佳纪录。 */

function setup() {
  window.localStorage.clear();
  setActivePinia(createPinia());
  const meta = useMetaStore();
  meta.ensureLoaded();
  return meta;
}

describe("1.0-C 成就墙", () => {
  it("通关一次记首通成就；三职业各通关一次记「三途归一」", () => {
    const meta = setup();
    meta.markCleared("bloodwright");
    const gained = meta.evaluateRun({ classId: "bloodwright", usedBloodpact: true, overloadCount: 0 });
    expect(meta.isAchieved("clear_bloodwright")).toBe(true);
    expect(meta.isAchieved("all_classes_clear")).toBe(false);
    expect(gained).toContain("bloodrust");
    meta.markCleared("engineer");
    meta.evaluateRun({ classId: "engineer", usedBloodpact: true, overloadCount: 0 });
    meta.markCleared("rustspeaker");
    meta.evaluateRun({ classId: "rustspeaker", usedBloodpact: true, overloadCount: 0 });
    expect(meta.isAchieved("all_classes_clear")).toBe(true);
    // 朝圣者之铃随三职业全通入池（内容解锁）
    expect(meta.isContentUnlocked("pilgrim_bell")).toBe(true);
  });

  it("统计型成就：贴线 / 打断 10 次 / 反噬 3 次 / 三枚强化 / 锈蚀难度 / 全图鉴", () => {
    const meta = setup();
    meta.markCleared("bloodwright");
    meta.addInterruptStat(10);
    meta.evaluateRun({
      classId: "bloodwright",
      usedBloodpact: false,
      overloadCount: 3,
      backlashTaken: 3,
      pollutionPeak: 99,
      enhancementsAttached: 3,
      difficulty: "rust",
      codexComplete: true,
    });
    for (const id of ["no_bloodpact_clear","overload3_clear","interrupt10","backlash3_win","pollution99_end","enhance3","rust_clear","codex_all"]) {
      expect(meta.isAchieved(id)).toBe(true);
    }
  });

  it("未达成的成就不写入；失败局不计成就", () => {
    const meta = setup();
    meta.markCleared("bloodwright");
    meta.evaluateRun({ classId: "bloodwright", usedBloodpact: true, overloadCount: 1, won: false });
    expect(meta.isAchieved("clear_bloodwright")).toBe(false);
    expect(meta.lastAchievements).toHaveLength(0);
  });

  it("15 条成就全部可达（含教学「引路人」「三朝守夜」与真结局），且都有 i18n 文案", async () => {
    const meta = setup();
    // 每个职业通关各结算一次（真实流程同款），最后用锈语者补齐统计类成就
    for (const id of ["bloodwright", "engineer", "rustspeaker"]) {
      meta.markCleared(id);
      meta.evaluateRun({ classId: id, usedBloodpact: true, overloadCount: 0 });
    }
    meta.addInterruptStat(10);
    meta.evaluateRun({
      classId: "rustspeaker",
      usedBloodpact: false,
      overloadCount: 3,
      backlashTaken: 3,
      pollutionPeak: 99,
      enhancementsAttached: 3,
      difficulty: "rust",
      codexComplete: true,
      turns: 120,
      hpLeft: 30,
      // 真结局（docs/66 §4.4）：打完最后一幕才算
      finale: true,
    });
    // 「引路人」「三朝守夜」来自教学完成，不属于远征结算（docs/41 §4.3 / docs/43 Q6）
    meta.markTutorialDone("bloodwright");
    expect(meta.isAchieved("guide")).toBe(true);
    meta.markTutorialDone("engineer");
    meta.markTutorialDone("rustspeaker");
    expect(meta.isAchieved("three_watch")).toBe(true);
    expect(ACHIEVEMENT_IDS.every((id) => meta.isAchieved(id))).toBe(true);
    const { loadGameContent } = await import("@/data/load");
    const i18n = loadGameContent().i18n;
    for (const id of ACHIEVEMENT_IDS) {
      expect(i18n[`ach.${id}.name`]).toBeTruthy();
      expect(i18n[`ach.${id}.desc`]).toBeTruthy();
    }
  });

  it("成就 / 纪录 / 累计统计写入 meta 存档并可读回", () => {
    const meta = setup();
    meta.markCleared("bloodwright");
    meta.evaluateRun({ classId: "bloodwright", usedBloodpact: true, overloadCount: 0 });
    meta.updateRecord("bloodwright", 25, 30);
    meta.addInterruptStat(4);
    meta.persist();
    // 模拟重开：新 pinia + 从 localStorage 读档
    setActivePinia(createPinia());
    const reloaded = useMetaStore();
    reloaded.ensureLoaded();
    expect(reloaded.isAchieved("clear_bloodwright")).toBe(true);
    expect(reloaded.recordOf("bloodwright")).toEqual({ minTurns: 25, maxHp: 30 });
    expect(reloaded.stats.interrupts).toBe(4);
  });

  it("最佳纪录：只记录更优值", () => {
    const meta = setup();
    meta.updateRecord("bloodwright", 30, 20);
    expect(meta.recordOf("bloodwright")).toEqual({ minTurns: 30, maxHp: 20 });
    meta.updateRecord("bloodwright", 22, 12);
    expect(meta.recordOf("bloodwright")).toEqual({ minTurns: 22, maxHp: 20 });
    meta.updateRecord("bloodwright", 40, 35);
    expect(meta.recordOf("bloodwright")).toEqual({ minTurns: 22, maxHp: 35 });
  });

  it("普通 / 锈蚀分难度各记一栏，互不覆盖（甲方 2026-10-08）", () => {
    const meta = setup();
    meta.updateRecord("bloodwright", 20, 30, "normal");
    meta.updateRecord("bloodwright", 35, 10, "rust");
    expect(meta.recordOf("bloodwright", "normal")).toEqual({ minTurns: 20, maxHp: 30 });
    expect(meta.recordOf("bloodwright", "rust")).toEqual({ minTurns: 35, maxHp: 10 });
    // 锈蚀打得更好只覆盖锈蚀榜，普通榜不动
    meta.updateRecord("bloodwright", 18, 40, "rust");
    expect(meta.recordOf("bloodwright", "rust")).toEqual({ minTurns: 18, maxHp: 40 });
    expect(meta.recordOf("bloodwright", "normal")).toEqual({ minTurns: 20, maxHp: 30 });
    // 缺省难度 = 普通档（旧调用点不吃惊）
    expect(meta.recordOf("engineer")).toEqual({ minTurns: null, maxHp: null });
    meta.updateRecord("engineer", 12, 8);
    expect(meta.recordOf("engineer", "normal")).toEqual({ minTurns: 12, maxHp: 8 });
    expect(meta.recordOf("engineer", "rust")).toEqual({ minTurns: null, maxHp: null });
    // 完成日期（甲方 2026-10-08「完成时间改为日期」）：与另两项一样跟「刷新」走，
    // 缺省不带就不写这个键
    expect(meta.recordOf("engineer").date).toBeUndefined();
    // 首刷（更优）：写入日期
    meta.updateRecord("engineer", 10, 20, "normal", "2026-10-01");
    expect(meta.recordOf("engineer").date).toBe("2026-10-01");
    // 更差的一次：不刷新 → 日期保持原样
    meta.updateRecord("engineer", 15, 5, "normal", "2026-10-02");
    expect(meta.recordOf("engineer").date).toBe("2026-10-01");
    // 回合更少（刷新）→ 日期更新
    meta.updateRecord("engineer", 8, 5, "normal", "2026-10-03");
    expect(meta.recordOf("engineer").date).toBe("2026-10-03");
  });

  it("相同职业不同特性分别记一栏，互不覆盖（甲方 2026-10-08）", () => {
    const meta = setup();
    meta.updateRecord("engineer", 20, 30, "normal", "2026-10-01", "ironhide_turtle");
    meta.updateRecord("engineer", 35, 10, "normal", "2026-10-02", "glass_cannon");
    meta.updateRecord("engineer", 28, 22, "normal", "2026-10-03", ""); // 无特性
    expect(meta.recordOf("engineer", "normal", "ironhide_turtle").minTurns).toBe(20);
    expect(meta.recordOf("engineer", "normal", "glass_cannon").minTurns).toBe(35);
    expect(meta.recordOf("engineer", "normal", "").minTurns).toBe(28);
    // 不带 traitId → 取全特性里最好的一条（回合最少）
    expect(meta.recordOf("engineer", "normal").minTurns).toBe(20);
    // 分特性榜：三档各一条；无特性档对外统一给空串
    const rows = meta.recordsByTrait("engineer", "normal");
    expect(rows.map((r) => r.traitId).sort()).toEqual(["", "glass_cannon", "ironhide_turtle"]);
  });

  it("旧档迁移：职业名 / 职业:难度 两种旧键都补成三段式，成绩不丢", async () => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    const { writeSlot } = await import("@/systems/save");
    // 旧格式①：只有职业名（分难度之前）；旧格式②：职业:难度（特性系统之前）
    writeSlot("meta", {
      records: {
        bloodwright: { minTurns: 24, maxHp: 18 },
        "engineer:rust": { minTurns: 30, maxHp: 12 },
      },
    });
    const meta = useMetaStore();
    meta.ensureLoaded();
    // 两种旧键都归到「无特性」档
    expect(meta.recordOf("bloodwright", "normal", "").minTurns).toBe(24);
    expect(meta.recordOf("engineer", "rust", "").minTurns).toBe(30);
    // 总览口径也读得到
    expect(meta.recordOf("bloodwright", "normal").minTurns).toBe(24);
    expect(meta.recordOf("bloodwright", "rust")).toEqual({ minTurns: null, maxHp: null });
  });
});

describe("1.0-C 局内计数", () => {
  it("run store 累计断链 / 反噬 / 回合 / 污染峰值", () => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    const run = useRunStore();
    run.startRun("bloodwright", 5);
    run.noteInterrupt();
    run.noteInterrupt();
    run.noteBacklash();
    run.noteTurns(12);
    run.setPollution(99);
    run.setPollution(40);
    expect(run.run?.interrupts).toBe(2);
    expect(run.run?.backlashTaken).toBe(1);
    expect(run.run?.turns).toBe(12);
    expect(run.run?.pollutionPeak).toBe(99);
  });
});
