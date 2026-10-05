/**
 * ui/tip-position · 注解窗定位（纯函数，便于单测）
 *
 * 关键点：不能直接用 getBoundingClientRect() 的外接盒取边——手牌卡牌绕底边旋转，
 * 外接盒相对真实边缘的偏移随旋转方向改变，导致左右卡牌间距不一致。
 *
 * 这里改用「不受 transform 影响的布局位置」(offsetLeft/offsetTop) 推算出悬停后
 * 的真实视觉框，再以固定间距定位，因此所有卡牌的间距完全一致。
 */

export const TIP_WIDTH = 236;
export const TIP_GAP = 12;
/** 悬停放大参数，必须与 CardView 的 :hover 规则一致 */
export const HOVER_HAND = { scale: 1.12, translateY: -52, origin: "bottom" as const };
export const HOVER_DISPLAY = { scale: 1.05, translateY: -10, origin: "center" as const };

export interface TipLayoutInput {
  /** 卡牌在 offsetParent 内的布局位置（不含 transform） */
  offsetLeft: number;
  offsetTop: number;
  offsetWidth: number;
  offsetHeight: number;
  /** offsetParent 的屏幕坐标（左上角） */
  parentLeft: number;
  parentTop: number;
  /** 舞台缩放（--stage-scale） */
  scale: number;
  /** 是否为展示模式（奖励/锻造） */
  display: boolean;
}

export interface TipPlacement {
  left: number;
  top: number;
  side: "right" | "left";
  /** 悬停后卡牌的视觉框（便于测试间距一致性） */
  visualLeft: number;
  visualTop: number;
  visualRight: number;
}

export function computeTipPlacement(
  input: TipLayoutInput,
  viewportWidth: number,
  viewportHeight: number,
): TipPlacement {
  const spec = input.display ? HOVER_DISPLAY : HOVER_HAND;
  const w = input.offsetWidth * input.scale;
  const h = input.offsetHeight * input.scale;
  const sw = w * spec.scale;
  const sh = h * spec.scale;
  const layoutLeft = input.parentLeft + input.offsetLeft * input.scale;
  const layoutTop = input.parentTop + input.offsetTop * input.scale;
  const cx = layoutLeft + w / 2;

  let visualLeft: number;
  let visualTop: number;
  if (spec.origin === "bottom") {
    visualLeft = cx - sw / 2;
    visualTop = layoutTop + h - sh + spec.translateY * input.scale;
  } else {
    visualLeft = cx - sw / 2;
    visualTop = layoutTop + h / 2 - sh / 2 + spec.translateY * input.scale;
  }
  const visualRight = visualLeft + sw;

  const rightCandidate = visualRight + TIP_GAP;
  const fitsRight = rightCandidate + TIP_WIDTH <= viewportWidth - 8;
  const side: "right" | "left" = fitsRight ? "right" : "left";
  const left = fitsRight ? rightCandidate : Math.max(8, visualLeft - TIP_GAP - TIP_WIDTH);
  const top = Math.min(Math.max(8, visualTop), Math.max(8, viewportHeight - 210));

  return { left, top, side, visualLeft, visualTop, visualRight };
}
