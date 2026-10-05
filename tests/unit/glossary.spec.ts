import { describe, expect, it } from "vitest";
import { GLOSSARY, highlightText, keywordTip, termsIn } from "@/ui/glossary";

describe("关键词注解（UI）", () => {
  it("只标注需要解释的机制词", () => {
    const html = highlightText("给予目标 1 层易伤。");
    expect(html).toContain('class="kw"');
    expect(html).toContain("易伤");
  });

  it("字面即懂的词不标注（卖 / 血 不进注解表）", () => {
    expect(GLOSSARY["卖"]).toBeUndefined();
    expect(highlightText("卖 2 血。")).toBe("卖 2 血。");
  });

  it("虚弱 / 污染 / 格挡 / 血契 都有解释", () => {
    for (const word of ["虚弱", "污染", "格挡", "血契", "消耗", "易伤", "充能"]) {
      expect(highlightText(`${word}测试`)).toContain('class="kw"');
      expect(keywordTip(word).length).toBeGreaterThan(0);
    }
  });

  it("termsIn 去重且按首次出现顺序", () => {
    expect(termsIn("虚弱与易伤，以及虚弱再次。")).toEqual(["虚弱", "易伤"]);
    expect(termsIn("造成 9 点伤害")).toEqual([]);
  });

  it("HTML 转义，避免注入", () => {
    const html = highlightText("<b>易伤</b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("单次扫描：一个词只包一次", () => {
    expect((highlightText("易伤").match(/class="kw"/g) ?? [])).toHaveLength(1);
  });

  it("未知词返回空解释", () => {
    expect(keywordTip("不存在的词")).toBe("");
    expect(Object.keys(GLOSSARY).length).toBeGreaterThan(8);
  });
});
