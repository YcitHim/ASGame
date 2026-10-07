import { describe, expect, it } from "vitest";
import { loadGameContent } from "@/data/load";
import { relicFitNote, relicResourceFit, requiredResource } from "@/ui/relic-fit";

/**
 * docs/43 §2.4：随身遗物「机制不合置灰」。
 * 判定按效果文本静态扫描：只认"需要什么资源"，不认"给什么资源"。
 */
const game = loadGameContent();

describe("docs/43 §2.4 · 随身遗物相性", () => {
  // docs/50 §三：压力表重做后只剩 gainCharge，静态扫描看成「给资源」，
  // 策划人工标注为「仅炉心相性」，其余职业照常出现但置灰不可选。
  it("压力表人工标注为炉心专属：只有工程师相性 OK，其余职业置灰并给出标注", () => {
    expect(requiredResource(game.content.relics.get("pressuregauge")!)).toBe("charge");
    expect(relicResourceFit("pressuregauge", "engineer", game.content).ok).toBe(true);
    for (const cls of ["bloodwright", "rustspeaker"]) {
      const fit = relicResourceFit("pressuregauge", cls, game.content);
      expect(fit.ok).toBe(false);
      expect(relicFitNote(fit)).toBe("炉心充能件——本职业无充能机制");
    }
  });

  it("机制不合的件标注会说清「缺哪个机制」（血泵 → 卖血）", () => {
    const fit = relicResourceFit("blood_pump", "engineer", game.content);
    expect(fit.ok).toBe(false);
    expect(relicFitNote(fit)).toContain("卖血");
    // 相性 OK 的件没有标注
    expect(relicFitNote(relicResourceFit("blood_pump", "bloodwright", game.content))).toBe("");
  });

  it("血泵挂在卖血时机 → 只与血械侍僧相性", () => {
    expect(requiredResource(game.content.relics.get("blood_pump")!)).toBe("blood");
    expect(relicResourceFit("blood_pump", "bloodwright", game.content).ok).toBe(true);
    expect(relicResourceFit("blood_pump", "engineer", game.content).ok).toBe(false);
    expect(relicResourceFit("blood_pump", "rustspeaker", game.content).ok).toBe(false);
  });

  it("通用件（格挡 / 回血 / 抽牌 / 力量）对三职业都相性 OK", () => {
    for (const id of ["bandage", "old_photo", "redtear_ring", "rust_dowsing", "whetstone", "gear_coin"]) {
      // gear_coin（抽牌）与资源无关；其余同样与职业机制无关
      for (const cls of ["bloodwright", "engineer", "rustspeaker"]) {
        expect(relicResourceFit(id, cls, game.content).ok).toBe(true);
      }
    }
  });
});
