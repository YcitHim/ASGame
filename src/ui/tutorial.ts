/**
 * ui/tutorial · 「第一班岗」脚本（docs/42，2026-10-07 按甲方要求重构为速成版）
 *
 * 目标变了：不是"陪着走完一段微型远征"，而是**几分钟内让新手看懂屏幕、敢出手**。
 * 甲方原话：「进入第一关，告知哪里是状态栏、哪里看剩余能量、哪里是手牌区、哪里是敌人意图；
 * 然后教怎么攻击、怎么防御、对方的异常状态、诅咒效果。就差不多够了，你这个太墨迹了。」
 *
 * 所以这一版只有**一场战斗**，八个步骤：
 *   ① 状态栏 ② 能量 ③ 手牌区 ④ 敌人意图（四个"这是哪儿"）→ ⑤ 攻击 → ⑥ 防御
 *   → ⑦ 敌人给你挂的异常 → ⑧ 打掉它
 * 每条一句话，玩家点「知道了」才翻页；幕间、三课、结业清单全部砍掉。
 */

/** 步骤完成判定（保持少而硬：能靠事件判的绝不让人点）。 */
export type TutorialGoal =
  /** 读完一句，点「知道了」翻页（UI 导览用） */
  | { kind: "acknowledge" }
  /** 打出某类牌（attack / skill） */
  | { kind: "playType"; cardType: string }
  /** 打出指定牌（职业机制课用；当前脚本未使用，保留给后续） */
  | { kind: "playCardId"; cardId: string }
  /** 带着格挡结束回合 */
  | { kind: "blockEndTurn"; min: number }
  /** 敌人给你挂了异常（污染 / 虚弱 / 易伤…） */
  | { kind: "playerDebuffed" }
  /** 清场 */
  | { kind: "killAll" };

/** 这一步要高亮屏幕上的哪一块（UI 导览的核心：说到哪指到哪）。 */
export type TutorialFocus = "status" | "energy" | "hand" | "intent";

export interface TutorialStep {
  /** 这是什么（第一行，金色） */
  readonly why: string;
  /** 它为什么重要 / 你要做什么（第二行） */
  readonly how: string;
  /** 高亮屏幕上的一块区域 */
  readonly focus?: TutorialFocus;
  /** 高亮这一类手牌 */
  readonly highlightType?: string;
  /** 高亮这张牌 */
  readonly highlightCardId?: string;
  /** 这一步开始时把这几张牌塞进手牌 */
  readonly grant?: readonly string[];
  /** 同上，按职业给（防御课要用本职业的格挡牌） */
  readonly classGrant?: Readonly<Record<string, readonly string[]>>;
  readonly goal: TutorialGoal;
  /** 严判定：没做到就不推进，给一句纠正 */
  readonly strict?: boolean;
  readonly correct?: string;
}

export interface TutorialBattle {
  readonly kind: "battle";
  readonly id: string;
  readonly title: string;
  readonly theme: string;
  readonly enemies: readonly string[];
  /** 教学用：统一覆盖敌人 HP，保证机制讲完之前它不会先死 */
  readonly enemyHp?: number;
  readonly seed: number;
  /** 旁白落款（docs/43 §三 #11）：老班长「铆叔」。彩蛋级存在，不展开剧情。 */
  readonly byline?: string;
  readonly steps: readonly TutorialStep[];
}

export interface TutorialGraduationChapter {
  readonly kind: "graduation";
  readonly id: string;
  readonly title: string;
  readonly lines: readonly string[];
  /** 署名（docs/43 §三 #11） */
  readonly byline?: string;
  readonly cta: string;
}

export type TutorialChapter = TutorialBattle | TutorialGraduationChapter;

export const TUTORIAL_TITLE = "第一班岗";

/** 教学旁白 = 老一代守夜人（docs/43 §三 #11 起名「铆叔」）。 */
export const TUTORIAL_NARRATOR = "铆叔";

/**
 * 只教一件事：**看懂屏幕 + 敢出手**。
 * 敌人选「浊化布道者」（36 血，会攻击 / 挂污染 / 挂虚弱），种子 9 的意图序列是
 * 攻击 → 污染 → 攻击 → 虚弱——正好把"防御"和"异常"两课按顺序送到玩家脸上。
 */
export const TUTORIAL_CHAPTERS: readonly TutorialChapter[] = [
  {
    kind: "battle",
    id: "lesson1",
    title: "第一课 · 看懂屏幕",
    theme: "你不需要记住所有规则，只要先认全这块屏幕。",
    enemies: ["polluting_preacher"],
    // 提到 60 血：它要活到把「异常」那一课演完
    enemyHp: 60,
    seed: 9,
    byline: "—— 铆叔 · 老一代守夜人",
    steps: [
      {
        why: "这是你的状态栏",
        how: "红条是你的命；下面依次是格挡、状态。敌人给你挂的异常也显示在这里。",
        focus: "status",
        goal: { kind: "acknowledge" },
      },
      {
        why: "这是能量",
        how: "每回合回满。打牌花的就是它，用不完不隔夜。",
        focus: "energy",
        goal: { kind: "acknowledge" },
      },
      {
        why: "这是手牌区",
        how: "你的动作全在这里。左上角数字是费用，数字变灰就是现在打不起。",
        focus: "hand",
        goal: { kind: "acknowledge" },
      },
      {
        why: "这是敌人意图",
        how: "它头顶的图标预告下回合要干什么：剑＝攻击（数字就是伤害），写「弱」「污」的＝给你挂异常。",
        focus: "intent",
        goal: { kind: "acknowledge" },
      },
      {
        why: "先摸清它有多疼",
        how: "点一张高亮的攻击牌打出去。",
        highlightType: "attack",
        goal: { kind: "playType", cardType: "attack" },
      },
      {
        why: "格挡是临时的血：先替你挨，每回合开始清零。",
        how: "它要动手了——打一张防御牌叠格挡，再结束回合。",
        highlightType: "skill",
        // 起手 5 张里有没有防御是发牌运气，保底发一张本职业的格挡牌
        classGrant: {
          bloodwright: ["defend"],
          engineer: ["brassguard"],
          rustspeaker: ["scrapguard"],
        },
        goal: { kind: "blockEndTurn", min: 1 },
        strict: true,
        correct: "这一下会打在你身上——先打一张高亮的防御牌，再结束回合。",
      },
      {
        why: "你被挂了异常",
        how: "看状态栏。污染攒到 100 会反噬你 10 点；虚弱让你造成的伤害 ×0.75。敌人不打你的时候，多半就是在给你上这些。",
        focus: "status",
        goal: { kind: "playerDebuffed" },
      },
      {
        why: "剩下的就是把它打掉。",
        how: "顶不住就先叠格挡。到这儿你基本会玩了——后面遇到新东西，屏幕上会自己提示你。",
        goal: { kind: "killAll" },
      },
    ],
  },
  {
    kind: "graduation",
    id: "graduation",
    title: "上 手 了",
    lines: [
      "三分钟，够你出门了：认屏幕、出牌、防御、看异常。",
      "剩下的（遗物、强化、路线）交给图鉴和屏幕提示——想再听一遍，设置里随时叫铆叔。",
    ],
    byline: "—— 铆叔",
    cta: "开 始 远 征",
  },
];

export function tutorialChapter(index: number): TutorialChapter | undefined {
  return TUTORIAL_CHAPTERS[index];
}

/** 取本章的步骤表（保留函数形态，视图与状态机都走它）。 */
export function chapterSteps(chapter: TutorialChapter | undefined): readonly TutorialStep[] {
  return chapter?.kind === "battle" ? chapter.steps : [];
}
