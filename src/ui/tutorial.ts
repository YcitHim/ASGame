/**
 * ui/tutorial · 教学遭遇战脚本（docs/41 §4.3）
 *
 * 规模控制（策划 §4.3）：**只做固定脚本 3 场**，每场一个主题——
 * 出牌与能量 / 读意图与防御 / 蓄力与爆发。词条靠首遇提示，进阶靠玩家社区。
 * 脚本固定的是：敌人、种子、步骤与判定；卡组用玩家所选职业的起始卡组，
 * 这样教学里出现的牌就是他真正要用的牌（策划未规定，按最小惊讶原则处理并登记）。
 */
export type TutorialStepDone =
  | { readonly kind: "playType"; readonly cardType: string }
  | { readonly kind: "endTurn" };

export interface TutorialStep {
  /** 场上的一句话提示 */
  readonly hint: string;
  /** 高亮这一类手牌（attack / skill），让"该点哪张"一眼可见 */
  readonly highlightType?: string;
  readonly done: TutorialStepDone;
}

export interface TutorialStage {
  readonly id: string;
  readonly title: string;
  /** 这一场教会什么（入场文案） */
  readonly theme: string;
  readonly enemies: readonly string[];
  /** 固定种子：敌人意图序列因此固定，脚本才敢写死台词（种子已按预期意图挑过） */
  readonly seed: number;
  readonly steps: readonly TutorialStep[];
}

export const TUTORIAL_STAGES: readonly TutorialStage[] = [
  {
    id: "basics",
    title: "第一课 · 出牌与能量",
    theme: "每回合回复固定能量，打牌花能量——用不完不会留到下回合。",
    enemies: ["rust_hound"],
    seed: 7,
    steps: [
      {
        hint: "点一张高亮的攻击牌打出——左上角数字是它的费用。",
        highlightType: "attack",
        done: { kind: "playType", cardType: "attack" },
      },
      {
        hint: "再打一张。能量用完之前，能打就打。",
        highlightType: "attack",
        done: { kind: "playType", cardType: "attack" },
      },
      {
        hint: "没能量了，就点右下角的「结束回合」交给敌人行动。",
        done: { kind: "endTurn" },
      },
    ],
  },
  {
    id: "intent",
    title: "第二课 · 读意图与防御",
    theme: "敌人头顶的图标预告它下回合要做什么——数字就是它要打你的伤害。",
    enemies: ["corroded_swarm"],
    seed: 1,
    steps: [
      {
        hint: "先看一眼敌人头顶：它写着攻击，就是在说「下回合我要打你」。",
        done: { kind: "endTurn" },
      },
      {
        hint: "要挨打了——打一张高亮的防御牌，先把格挡叠起来。",
        highlightType: "skill",
        done: { kind: "playType", cardType: "skill" },
      },
      {
        hint: "格挡每回合开始清零，所以要在挨打前用。继续，直到把它打掉。",
        done: { kind: "endTurn" },
      },
    ],
  },
  {
    id: "charge",
    title: "第三课 · 蓄力与爆发",
    theme: "敌人会蓄力攒一次重击。它会提前两回合把释放值写在头顶，你来得及准备。",
    enemies: ["riveted_heavy"],
    seed: 10,
    steps: [
      {
        hint: "敌人架起了格挡，头顶写着「蓄力 · 回合后释放」——它在攒一次重击。",
        done: { kind: "endTurn" },
      },
      {
        hint: "红框里的「即将承受 X 伤害」就是那一下。先叠格挡顶住它。",
        highlightType: "skill",
        done: { kind: "playType", cardType: "skill" },
      },
      {
        hint: "顶住之后就是你的回合——全力输出，把它打掉。",
        done: { kind: "endTurn" },
      },
    ],
  },
];

export function tutorialStage(index: number): TutorialStage | undefined {
  return TUTORIAL_STAGES[index];
}
