import { onBeforeUnmount, onMounted, type Ref } from "vue";

/** 基准画布 1280×720 等比缩放（docs/08 §4）。 */
export function useStageFit(stage: Ref<HTMLElement | null>) {
  function fit(): void {
    const el = stage.value;
    if (!el) return;
    const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    el.style.transform = `scale(${scale})`;
  }

  onMounted(() => {
    fit();
    window.addEventListener("resize", fit);
  });
  onBeforeUnmount(() => window.removeEventListener("resize", fit));

  return { fit };
}
