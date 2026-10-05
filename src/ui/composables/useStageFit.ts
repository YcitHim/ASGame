import { onBeforeUnmount, onMounted, type Ref } from "vue";

/**
 * 基准画布 1280×720 等比缩放（docs/08 §4）。
 *
 * 缩放值写进 CSS 变量 `--stage-scale`，由 base.css 的 .stage transform 消费——
 * 这样任何用 transform 的动画（如屏震）只要带上该变量就不会把缩放覆盖掉。
 */
export function useStageFit(stage: Ref<HTMLElement | null>) {
  function fit(): void {
    const el = stage.value;
    if (!el) return;
    const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    el.style.setProperty("--stage-scale", String(scale));
  }

  onMounted(() => {
    fit();
    window.addEventListener("resize", fit);
  });
  onBeforeUnmount(() => window.removeEventListener("resize", fit));

  return { fit };
}
