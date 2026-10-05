import { describe, expect, it } from "vitest";
import { TIP_GAP, TIP_WIDTH, computeTipPlacement, type TipLayoutInput } from "@/ui/tip-position";

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
