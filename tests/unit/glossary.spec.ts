import { describe, expect, it } from "vitest";
import { GLOSSARY, highlightText, keywordTip } from "@/ui/glossary";

describe("关键词注解（UI）", () => {
  it("描述里的机制词被包成带解释的蓝字 span", () => {
    const html = highlightText("给予目标 1 层易伤。");
    expect(html).toContain('class="kw"');
    expect(html).toContain("易伤");
    expect(html).toContain("data-tip=");
    expect(html).toContain("×1.5");
  });

  it("虚弱 / 污染 / 格挡 都有解释", () => {
    for (const word of ["虚弱", "污染", "格挡", "血契", "消耗"]) {
      const html = highlightText(`${word}测试`);
      expect(html).toContain("data-tip=");
      expect(keywordTip(word).length).toBeGreaterThan(0);
    }
  });

  it("HTML 转义，避免注入", () => {
    const html = highlightText("<b>易伤</b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("单次扫描：不会把解释文本里的词再包一层", () => {
    const html = highlightText("易伤");
    const matches = html.match(/class="kw"/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("未知词返回空解释", () => {
    expect(keywordTip("不存在的词")).toBe("");
    expect(Object.keys(GLOSSARY).length).toBeGreaterThan(8);
  });
});
