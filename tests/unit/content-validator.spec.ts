import { describe, expect, it } from "vitest";
import { loadContent } from "../../tools/content-validator/src/load-data";
import { formatIssues, validateContent, type ContentInput } from "../../tools/content-validator/src/validate-content";

function baseInput(): ContentInput {
  return {
    cards: [
      {
        file: "src/data/cards/bloodwright/bloodbolt.json",
        data: {
          id: "bloodbolt",
          class: "bloodwright",
          type: "attack",
          rarity: "common",
          cost: 1,
          keywords: ["bloodpact"],
          bloodCost: 2,
          effects: [{ kind: "damage", target: { type: "chosenEnemy" }, value: 9 }],
          i18n: "card.bloodbolt",
        },
      },
    ],
    enhancements: [],
    i18n: {
      "card.bloodbolt.name": "血之螺栓",
      "card.bloodbolt.desc": "卖 2 血，造成 9 点伤害。",
    },
  };
}

describe("content-validator（G1）", () => {
  it("仓库内真实内容全部通过", () => {
    const { issues } = validateContent(loadContent());
    expect(issues).toEqual([]);
  });

  it("写错 handler 名会报错并带文件与字段定位", () => {
    const input = baseInput();
    (input.cards[0].data as Record<string, unknown>).play = { handler: "bloodbolt_typo", params: {} };
    const { issues } = validateContent(input);
    const hit = issues.find((i) => i.path.includes("handler") || i.message.includes("handler"));
    expect(hit, "未捕获未注册 handler").toBeDefined();
    const text = formatIssues(issues);
    expect(text).toContain("bloodbolt.json");
    expect(text).toContain("handler");
  });

  it("写错 keyword 名会报错", () => {
    const input = baseInput();
    (input.cards[0].data as Record<string, unknown>).keywords = ["bloodpact_typo"];
    const { issues } = validateContent(input);
    expect(issues.some((i) => i.path.includes("keywords"))).toBe(true);
  });

  it("缺失 i18n 文案会报错", () => {
    const input = baseInput();
    input.i18n = {};
    const { issues } = validateContent(input);
    expect(issues.some((i) => i.message.includes("card.bloodbolt.name"))).toBe(true);
  });

  it("appliesTo 指向不存在的卡牌会报错", () => {
    const input = baseInput();
    input.enhancements = [
      {
        file: "src/data/enhancements/ghost.json",
        data: {
          id: "ghost",
          tier: 2,
          appliesTo: ["not_a_card"],
          handler: "bloodboil",
          params: {},
          i18n: "enh.ghost",
        },
      },
    ];
    input.i18n = { ...input.i18n, "enh.ghost.name": "幽灵", "enh.ghost.desc": "x" };
    const { issues } = validateContent(input);
    expect(issues.some((i) => i.path === "appliesTo")).toBe(true);
  });
});
