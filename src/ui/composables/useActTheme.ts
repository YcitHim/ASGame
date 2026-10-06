import { watchEffect } from "vue";
import { useRunStore } from "@/stores/run";

/**
 * 幕主题（docs/40 §四①）：把当前幕写到 <html> 的 act-N 类上，
 * 由 tokens.css 覆盖 --act-* 令牌，全站配色随之切换（第一幕赭红 / 第二幕青蓝）。
 * 挂在根元素而不是各视图上，是为了让地图 / 战斗 / 祭坛 / 事件 / 幕间用同一套令牌。
 */
export function useActTheme(): void {
  const run = useRunStore();
  watchEffect(() => {
    const root = document.documentElement;
    const act = (run.run?.actIndex ?? 0) + 1;
    for (let i = 1; i <= 4; i += 1) {
      root.classList.toggle(`act-${i}`, i === act);
    }
  });
}
