import { describe, expect, it } from "vitest";
import { GLOSSARY, highlightText, keywordTip, termsIn } from "@/ui/glossary";

describe("关键词注解（UI）", () => {
  it("只标注需要解释的机制词", () => {
    const html = highlightText("给予目标 1 层胆怯。");
    expect(html).toContain('class="kw"');
    expect(html).toContain("胆怯");
  });

  it("字面即懂的词不标注（卖 / 血 不进注解表）", () => {
    expect(GLOSSARY["卖"]).toBeUndefined();
    expect(highlightText("卖 2 血。")).toBe("卖 2 血。");
  });

  it("虚弱 / 污染 / 格挡 / 血契 都有解释", () => {
    for (const word of ["虚弱", "污染", "格挡", "血契", "消耗", "胆怯", "荆棘", "坚韧", "充能"]) {
      expect(highlightText(`${word}测试`)).toContain('class="kw"');
      expect(keywordTip(word).length).toBeGreaterThan(0);
    }
  });

  it("termsIn 去重且按首次出现顺序", () => {
    expect(termsIn("虚弱与胆怯，以及虚弱再次。")).toEqual(["虚弱", "胆怯"]);
    expect(termsIn("造成 9 点伤害")).toEqual([]);
  });

  it("HTML 转义，避免注入", () => {
    const html = highlightText("<b>胆怯</b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("单次扫描：一个词只包一次", () => {
    expect((highlightText("胆怯").match(/class="kw"/g) ?? [])).toHaveLength(1);
  });

  it("未知词返回空解释", () => {
    expect(keywordTip("不存在的词")).toBe("");
    expect(Object.keys(GLOSSARY).length).toBeGreaterThan(8);
  });
});

/** docs/41 §2.3 / §2.4：词条消歧与补全。 */
describe("docs/41 词条消歧", () => {
  it("「保留」明确指向手牌，不指格挡", () => {
    expect(GLOSSARY["保留"]).toContain("手牌");
    expect(GLOSSARY["保留"]).toContain("不是格挡");
  });

  it("护盾存续另立「维续」，与「保留」不混用", () => {
    expect(GLOSSARY["维续"]).toContain("格挡");
    expect(GLOSSARY["维续"]).not.toContain("保留");
  });

  it("补全「弃牌阶段」与「血契」词条", () => {
    expect(GLOSSARY["弃牌阶段"]).toContain("弃牌堆");
    expect(GLOSSARY["血契"]).toContain("成本");
    expect(GLOSSARY["血契"]).toContain("效果");
  });
});
