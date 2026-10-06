// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { useMetaStore } from "@/stores/meta";
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

  it("最佳纪录：只记录更优值", () => {
    const meta = setup();
    meta.updateRecord("bloodwright", 30, 20);
    expect(meta.recordOf("bloodwright")).toEqual({ minTurns: 30, maxHp: 20 });
    meta.updateRecord("bloodwright", 22, 12);
    expect(meta.recordOf("bloodwright")).toEqual({ minTurns: 22, maxHp: 20 });
    meta.updateRecord("bloodwright", 40, 35);
    expect(meta.recordOf("bloodwright")).toEqual({ minTurns: 22, maxHp: 35 });
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
