import { describe, expect, it } from "vitest";
import {
  BUFF_TIP_MAX_HEIGHT,
  TIP_GAP,
  TIP_WIDTH,
  computeBuffTipPlacement,
  computeTipPlacement,
  type TipLayoutInput,
} from "@/ui/tip-position";

/** 手牌：卡牌绕底边旋转，布局槽位固定；这里模拟 5 张手牌在 1280 舞台上的排布。 */
function handCard(slotIndex: number): TipLayoutInput {
  const cardWidth = 170;
  const cardHeight = 240;
  const handWidth = cardWidth + 4 * (cardWidth - 44); // margin -22 两侧重叠
  const handLeft = (1280 - handWidth) / 2;
  return {
    offsetLeft: slotIndex * (cardWidth - 44),
    offsetTop: 16,
    offsetWidth: cardWidth,
    offsetHeight: cardHeight,
    parentLeft: handLeft,
    parentTop: 0,
    scale: 1,
    display: false,
  };
}

/** docs/52 §3.2：状态提示框要避让计量条（失控线 / 污染条 / HP 条）。 */
describe("状态角标提示框定位（docs/52 §3.2）", () => {
  // 我方面板里的一个状态芯片：面板中轴偏左，上方 40px 处是 HP 条/失控线
  const chip = { left: 100, top: 300, width: 90, height: 34 };
  const hpbar = { left: 60, top: 250, right: 400, bottom: 280 };

  it("没有障碍物时默认朝上浮出", () => {
    const p = computeBuffTipPlacement(chip, 1280, 720);
    expect(p.above).toBe(true);
    expect(p.top).toBe(chip.top - 10);
  });

  it("朝上会盖住计量条 → 改朝下", () => {
    const p = computeBuffTipPlacement(chip, 1280, 720, [hpbar]);
    expect(p.above).toBe(false);
    expect(p.top).toBe(chip.top + chip.height + 10);
  });

  it("障碍物在别处时不误伤：仍然朝上", () => {
    const far = { left: 900, top: 250, right: 1100, bottom: 280 };
    expect(computeBuffTipPlacement(chip, 1280, 720, [far]).above).toBe(true);
  });

  it("上方顶出视口时翻到下方，且下方整框不越界", () => {
    const nearTop = { left: 100, top: 40, width: 90, height: 34 };
    const p = computeBuffTipPlacement(nearTop, 1280, 720);
    expect(p.above).toBe(false);
    expect(p.top + BUFF_TIP_MAX_HEIGHT).toBeLessThanOrEqual(720 - 8);
  });

  it("上下都装不下时（矮视口）把提示框夹进视口，绝不越界", () => {
    // 视口只有 100 高：上方放不下整框，下方也要夹住
    const chipInShortViewport = { left: 100, top: 20, width: 90, height: 34 };
    const p = computeBuffTipPlacement(chipInShortViewport, 1280, 100);
    expect(p.above).toBe(false);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + BUFF_TIP_MAX_HEIGHT).toBeLessThanOrEqual(100 - 8);
  });
});

describe("注解窗定位（间距一致性）", () => {
  it("最左与最右卡牌的间距完全相同（不会因旋转/位置变化）", () => {
    const leftCard = computeTipPlacement(handCard(0), 1920, 1080);
    const rightCard = computeTipPlacement(handCard(4), 1920, 1080);
    expect(leftCard.side).toBe("right");
    expect(rightCard.side).toBe("right");
    expect(leftCard.left - leftCard.visualRight).toBeCloseTo(TIP_GAP, 5);
    expect(rightCard.left - rightCard.visualRight).toBeCloseTo(TIP_GAP, 5);
  });

  it("右侧空间不足时翻到左边，间距依然是 TIP_GAP", () => {
    const placement = computeTipPlacement(handCard(4), 700, 720);
    expect(placement.side).toBe("left");
    expect(placement.visualLeft - (placement.left + TIP_WIDTH)).toBeCloseTo(TIP_GAP, 5);
  });

  it("展示模式（奖励/锻造）同样保持等距", () => {
    const base: TipLayoutInput = {
      offsetLeft: 100,
      offsetTop: 40,
      offsetWidth: 170,
      offsetHeight: 240,
      parentLeft: 0,
      parentTop: 0,
      scale: 1,
      display: true,
    };
    const a = computeTipPlacement(base, 1920, 1080);
    const b = computeTipPlacement({ ...base, offsetLeft: 900 }, 1920, 1080);
    expect(a.left - a.visualRight).toBeCloseTo(TIP_GAP, 5);
    expect(b.left - b.visualRight).toBeCloseTo(TIP_GAP, 5);
  });

  it("舞台缩放后视觉框与间距同步缩放", () => {
    const p = computeTipPlacement({ ...handCard(0), scale: 0.6 }, 1920, 1080);
    const width = p.visualRight - p.visualLeft;
    expect(width).toBeCloseTo(170 * 0.6 * 1.12, 4);
    expect(p.left - p.visualRight).toBeCloseTo(TIP_GAP, 5);
  });
});
