import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadGameContent } from "@/data/load";
import { replayBattle, type GoldenFile } from "../../tools/headless-sim/src/record";

/**
 * S6.2 golden replay 回归：只喂输入流，断言事件流哈希逐条一致。
 * 内容或结算改动会让哈希变化——这是有意的：改了玩法就要重新录制基线。
 */
const dir = fileURLToPath(new URL("../golden-replays", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

describe("golden replay 重放（S6.2）", () => {
  it("至少有 3 盘基线入库", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const name of files) {
    it(`${name} 重放事件流完全一致`, () => {
      const file = JSON.parse(readFileSync(join(dir, name), "utf8")) as GoldenFile;
      const result = replayBattle(file, loadGameContent().content);
      expect(result.turns).toBe(file.battle.turns);
      expect(result.outcome).toBe(file.battle.outcome);
      expect(result.hash).toBe(file.battle.eventHash);
    });
  }
});
