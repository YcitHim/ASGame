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

/** 状态角标提示框：宽度固定，默认显示在角标上方，空间不足时翻到下方。 */
export const BUFF_TIP_WIDTH = 208;
export const BUFF_TIP_MAX_HEIGHT = 76;

export interface BuffTipPlacement {
  /** 提示框的**水平中心**：样式里是 translate(-50%)，所以左右夹取都要按半宽算 */
  left: number;
  top: number;
  /** true = 在角标上方（translate(-50%,-100%)），false = 下方 */
  above: boolean;
}

/** 视口坐标下的矩形（getBoundingClientRect 的四个边）。 */
export interface TipRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function overlaps(a: TipRect, b: TipRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * 状态角标提示框定位（docs/52 §3.2）。
 *
 * 默认朝上浮出，但**若朝上会盖住障碍物（我方失控线/污染条 + HP 条）就改朝下**——
 * 障碍物由调用方实测传入（矩形相交判定，不写死像素，缩放/双幕自适应）。
 * 下方也放不下时夹进视口，绝不让提示框跑出屏幕。
 */
export function computeBuffTipPlacement(
  anchor: { left: number; top: number; width: number; height: number },
  viewportWidth: number,
  viewportHeight: number,
  obstacles: readonly TipRect[] = [],
): BuffTipPlacement {
  const half = BUFF_TIP_WIDTH / 2;
  const cx = anchor.left + anchor.width / 2;
  // 贴边时按半宽夹取——否则贴近屏幕左侧的角标会把提示框推出视口（实机：文字被切掉一半）
  const minCenter = 8 + half;
  const maxCenter = Math.max(minCenter, viewportWidth - 8 - half);
  const left = Math.min(Math.max(minCenter, cx), maxCenter);
  // 上方需要容纳提示框全高 + 间距；放不下就翻到下方
  const fitsAbove = anchor.top - BUFF_TIP_MAX_HEIGHT - 10 >= 8;
  const aboveRect: TipRect = {
    left: left - half,
    right: left + half,
    top: anchor.top - 10 - BUFF_TIP_MAX_HEIGHT,
    bottom: anchor.top - 10,
  };
  const coversObstacle = obstacles.some((o) => overlaps(aboveRect, o));
  const above = fitsAbove && !coversObstacle;
  const desiredTop = anchor.top + anchor.height + 10;
  // 下方：先夹进视口下沿，再保证整框不越界
  const top = above
    ? anchor.top - 10
    : Math.max(8, Math.min(desiredTop, viewportHeight - 8 - BUFF_TIP_MAX_HEIGHT));
  return { left, top, above };
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
