/**
 * useCardPeek · 卡牌悬停预览的定位逻辑（甲方 2026-10-08）
 *
 * 附魔 / 重铸 / 锻核「选一张牌附着」这些步骤原先只列卡名，玩家看不出这张牌是什么。
 * 鼠标放到某一行上，就在**整栏**左侧浮出它的完整卡面。
 *
 * 定位的两个坑（都踩过）：
 *  ① 舞台整体带 `transform: scale()`，`position: fixed` 在里面会被二次缩放（浮窗会飘到左上角）；
 *     所以换算成**舞台内坐标**再用 absolute。
 *  ② 列表行很宽，贴行浮动会把自己的行盖住——改为贴整栏左缘、垂直对齐到被悬停的行。
 */
import { ref, type Ref } from "vue";

export interface CardPeekState {
  readonly index: number;
  readonly left: number;
  readonly top: number;
}

/** CardView display 尺寸（`.card` = 170×240），舞台内坐标。 */
export const PEEK_W = 170;
export const PEEK_H = 240;

export function useCardPeek(stage: Ref<HTMLElement | null>, anchorSelector = ".col") {
  const peek = ref<CardPeekState | null>(null);

  function show(event: Event, index: number): void {
    const el = event.currentTarget as HTMLElement | null;
    const stageEl = stage.value;
    if (!el || !stageEl) return;
    const sr = stageEl.getBoundingClientRect();
    const scale = stageEl.offsetWidth > 0 ? sr.width / stageEl.offsetWidth : 1;
    const row = el.getBoundingClientRect();
    const col = (el.closest(anchorSelector) as HTMLElement | null)?.getBoundingClientRect() ?? row;
    const local = (v: number, origin: number) => (v - origin) / scale;
    const left = Math.max(8, local(col.left, sr.left) - PEEK_W - 14);
    const centerY = local(row.top, sr.top) + (row.bottom - row.top) / scale / 2;
    const top = Math.max(8, Math.min(centerY - PEEK_H / 2, stageEl.offsetHeight - PEEK_H - 8));
    peek.value = { index, left, top };
  }

  function hide(): void {
    peek.value = null;
  }

  return { peek, show, hide };
}
