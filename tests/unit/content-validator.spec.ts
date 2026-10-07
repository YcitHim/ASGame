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

  it("debuff 意图缺 buffId 会报错（docs/41 §2.2）", () => {
    const input = baseInput();
    input.enemies = [
      {
        file: "src/data/enemies/ghost.json",
        data: {
          id: "ghost",
          i18n: "enemy.ghost",
          maxHp: 10,
          intents: [{ intent: { kind: "debuff", stacks: 2 }, weight: 1 }],
        },
      },
    ];
    input.i18n = { ...input.i18n, "enemy.ghost.name": "幽灵" };
    const { issues } = validateContent(input);
    expect(issues.some((i) => i.message.includes("buffId"))).toBe(true);
  });

  it("docs/47 §三：攻击携带的眩晕同样必须预告（不能靠 attack 绕过蓄力/节拍约束）", () => {
    const naked = baseInput();
    naked.enemies = [
      {
        file: "src/data/enemies/ghost.json",
        data: {
          id: "ghost",
          i18n: "enemy.ghost",
          maxHp: 10,
          intents: [{ intent: { kind: "attack", value: 5, buffId: "stun", stacks: 1 }, weight: 1 }],
        },
      },
    ];
    naked.i18n = { ...naked.i18n, "enemy.ghost.name": "幽灵" };
    expect(validateContent(naked).issues.some((i) => i.message.includes("眩晕"))).toBe(true);

    // 蓄力链释放段附带眩晕 = 有预告，放行
    const chained = baseInput();
    chained.enemies = [
      {
        file: "src/data/enemies/flailer.json",
        data: {
          id: "flailer",
          i18n: "enemy.flailer",
          maxHp: 10,
          intents: [
            {
              intent: {
                kind: "charge",
                value: 4,
                releaseOverride: 18,
                thenIntent: { kind: "attack", value: 18, buffId: "stun", stacks: 1 },
              },
              weight: 1,
            },
          ],
        },
      },
    ];
    chained.i18n = { ...chained.i18n, "enemy.flailer.name": "链枷手" };
    expect(validateContent(chained).issues.some((i) => i.message.includes("眩晕"))).toBe(false);
  });

  it("docs/47 §四.2：分裂亡语禁止自指与链式分裂（分裂物不再分裂）", () => {
    const selfRef = baseInput();
    selfRef.enemies = [
      {
        file: "src/data/enemies/ooze.json",
        data: {
          id: "ooze", i18n: "enemy.ooze", maxHp: 10,
          onDeathSplit: { enemyId: "ooze", count: 2 },
          intents: [{ intent: { kind: "attack", value: 3 }, weight: 1 }],
        },
      },
    ];
    selfRef.i18n = { ...selfRef.i18n, "enemy.ooze.name": "史莱姆" };
    expect(validateContent(selfRef).issues.some((i) => i.message.includes("不能是自己"))).toBe(true);

    const chain = baseInput();
    chain.enemies = [
      {
        file: "src/data/enemies/big.json",
        data: {
          id: "big", i18n: "enemy.big", maxHp: 10,
          onDeathSplit: { enemyId: "small", count: 2 },
          intents: [{ intent: { kind: "attack", value: 3 }, weight: 1 }],
        },
      },
      {
        file: "src/data/enemies/small.json",
        data: {
          id: "small", i18n: "enemy.small", maxHp: 5,
          onDeathSplit: { enemyId: "tiny", count: 2 },
          intents: [{ intent: { kind: "attack", value: 1 }, weight: 1 }],
        },
      },
    ];
    chain.i18n = { ...chain.i18n, "enemy.big.name": "大", "enemy.small.name": "小" };
    expect(validateContent(chain).issues.some((i) => i.message.includes("不再分裂"))).toBe(true);

    // 引用不存在的分裂物也拦得住
    const ghost = baseInput();
    ghost.enemies = [
      {
        file: "src/data/enemies/ghost.json",
        data: {
          id: "ghost", i18n: "enemy.ghost", maxHp: 10,
          onDeathSplit: { enemyId: "not_here", count: 1 },
          intents: [{ intent: { kind: "attack", value: 3 }, weight: 1 }],
        },
      },
    ];
    ghost.i18n = { ...ghost.i18n, "enemy.ghost.name": "幽灵" };
    expect(validateContent(ghost).issues.some((i) => i.message.includes("未定义"))).toBe(true);
  });

  it("docs/45 Q11：正式内容数据里出现调试指令串会报错", () => {
    const input = baseInput();
    input.enemies = [
      {
        file: "src/data/enemies/ghost.json",
        data: {
          id: "ghost",
          i18n: "enemy.ghost",
          maxHp: 10,
          intents: [{ intent: { kind: "attack", value: 5 }, weight: 1 }],
          debugCommand: "intent ghost charge 2 4 10",
        },
      },
    ];
    input.i18n = { ...input.i18n, "enemy.ghost.name": "幽灵" };
    const { issues } = validateContent(input);
    expect(issues.some((i) => i.message.includes("调试指令"))).toBe(true);

    // 正常内容数据里不该出现（真实仓库已由上面那条 "全部通过" 覆盖）
    const clean = baseInput();
    expect(validateContent(clean).issues.some((i) => i.message.includes("调试指令"))).toBe(false);
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
