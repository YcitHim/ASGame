import { describe, expect, it } from "vitest";
import { loadGameContent } from "@/data/load";
import { relicResourceFit, requiredResource } from "@/ui/relic-fit";

/**
 * docs/43 §2.4：随身遗物「机制不合置灰」。
 * 判定按效果文本静态扫描：只认"需要什么资源"，不认"给什么资源"。
 */
const game = loadGameContent();

describe("docs/43 §2.4 · 随身遗物相性", () => {
  it("压力表需要充能 → 只与炉心机士相性", () => {
    expect(requiredResource(game.content.relics.get("pressuregauge")!)).toBe("charge");
    expect(relicResourceFit("pressuregauge", "engineer", game.content).ok).toBe(true);
    for (const cls of ["bloodwright", "rustspeaker"]) {
      const fit = relicResourceFit("pressuregauge", cls, game.content);
      expect(fit.ok).toBe(false);
      expect(fit.resource).toBe("充能");
      expect(fit.ownerClassId).toBe("engineer");
    }
  });

  it("血泵挂在卖血时机 → 只与血械侍僧相性", () => {
    expect(requiredResource(game.content.relics.get("blood_pump")!)).toBe("blood");
    expect(relicResourceFit("blood_pump", "bloodwright", game.content).ok).toBe(true);
    expect(relicResourceFit("blood_pump", "engineer", game.content).ok).toBe(false);
    expect(relicResourceFit("blood_pump", "rustspeaker", game.content).ok).toBe(false);
  });

  it("通用件（格挡 / 回血 / 抽牌 / 力量）对三职业都相性 OK", () => {
    for (const id of ["bandage", "old_photo", "redtear_ring", "rust_dowsing", "whetstone", "gear_coin"]) {
      for (const cls of ["bloodwright", "engineer", "rustspeaker"]) {
        expect(relicResourceFit(id, cls, game.content).ok).toBe(true);
      }
    }
  });
});
