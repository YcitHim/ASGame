/**
 * ui/first-tips · 首遇提示词条（docs/41 §4.1）
 *
 * 每类机制第一次出现时弹一条，玩家点「知道了 / 不再提示」后写入 meta 存档，
 * 跨局不再出现；图鉴页可随时回看全部条目。
 * 原则（策划 §4.1）：同屏至多 1 条；战斗高潮（Boss 释放回合）延后到行动结束。
 */
export interface FirstTipDefinition {
  readonly id: string;
  readonly title: string;
  /** 2~4 行的说明；用 \n 分行 */
  readonly body: string;
}

export const FIRST_TIPS: readonly FirstTipDefinition[] = [
  {
    id: "discard",
    title: "弃牌阶段",
    body: "每个你的回合结束时，没打出的手牌会进入弃牌堆。\n牌堆抽空后，弃牌堆会洗回牌堆——所以不用省着出牌。",
  },
  {
    id: "bloodpact",
    title: "血契（卖血）",
    body: "血械侍僧以自身生命催动卡牌：先付血，再收效果。\n牌面下方的「净 +N HP」已经把这两笔算在一起了。",
  },
  {
    id: "retain",
    title: "保留",
    body: "「保留」指回合结束时不弃置这张手牌。\n保留的是牌，不是格挡——格挡每回合开始都会清零。",
  },
  {
    id: "charge",
    title: "蓄力与重击",
    body: "敌人蓄力时会架起格挡，并在释放前一回合显示「即将承受 X 伤害」。\n看到红框就是重击回合，先防御再输出。",
  },
  {
    id: "energy",
    title: "能量",
    body: "每回合开始回复固定能量，用不完不会留到下回合。\n卡牌左上角的数字就是它的费用。",
  },
];

export function firstTip(id: string): FirstTipDefinition | undefined {
  return FIRST_TIPS.find((tip) => tip.id === id);
}
