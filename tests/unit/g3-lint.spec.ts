import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * G3 自测（docs/05）：
 * 在 src/core 下故意写违例代码，确认 lint 会红——证明规则真的有牙齿。
 */
const cwd = fileURLToPath(new URL("../../", import.meta.url));

async function lintCore(source: string) {
  const eslint = new ESLint({ cwd });
  const [result] = await eslint.lintText(source, { filePath: "src/core/__g3_probe__.ts" });
  return result.messages;
}

describe("G3 核心层确定性 lint", () => {
  it("Math.random 必须报错", async () => {
    const messages = await lintCore("export const roll = (): number => Math.random();\n");
    const hit = messages.find((m) => m.ruleId === "no-restricted-syntax");
    expect(hit, "Math.random 未被 G3 拦截").toBeDefined();
    expect(hit?.message).toContain("G3");
  });

  it("Date.now / new Date 必须报错", async () => {
    const now = await lintCore("export const t = (): number => Date.now();\n");
    expect(now.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true);
    const d = await lintCore("export const t = (): Date => new Date();\n");
    expect(d.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true);
  });

  it("反向依赖 ui / systems / vue 必须报错", async () => {
    const ui = await lintCore('import { x } from "@/ui/router";\nexport const y = x;\n');
    expect(ui.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
    const vue = await lintCore('import { ref } from "vue";\nexport const r = ref;\n');
    expect(vue.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
  });

  it("合法纯函数不产生 G3 报错", async () => {
    const messages = await lintCore("export const add = (a: number, b: number): number => a + b;\n");
    const g3 = messages.filter(
      (m) => m.ruleId === "no-restricted-syntax" || m.ruleId === "no-restricted-imports" || m.ruleId === "no-restricted-globals",
    );
    expect(g3).toEqual([]);
  });
});
