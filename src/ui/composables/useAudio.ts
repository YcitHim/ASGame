/**
 * composables/useAudio · 把音频层接到设置与首次手势上（docs/43 Q1 / docs/45 Q10）
 *
 * 只做三件事，不做任何音色判断（音色在 systems/audio 里）：
 *  ① 音量跟随设置：设置一变就把三个 GainNode 重设（watcher，含 reset）；
 *  ② 首次用户手势解锁 AudioContext（浏览器自动播放策略），随后开 BGM；
 *  ③ 主音量或音乐拉到 0 时停 BGM——不是静音，是省电，拉回来立刻复播。
 *
 * 无音频环境（jsdom / 旧浏览器）下全部 no-op：isAudioMuted 为 true 就什么都不做。
 */
import { computed, watch } from "vue";
import { storeToRefs } from "pinia";
import {
  applyVolumes,
  isAudioMuted,
  isBgmPlaying,
  startBgm,
  stopBgm,
  unlockAudio,
} from "@/systems/audio";
import { useSettingsStore } from "@/stores/settings";

/**
 * 试听入口转给设置页——设置页只认这个 composable，不直接依赖 systems/audio，
 * 将来换成真录音（buffer 播放）时设置页一行不用改。
 */
export { previewSfx, previewBgm, SFX_IDS, type SfxId } from "@/systems/audio";

/** 只安装一次手势监听（App 只会挂一次，但热更新会重跑 setup）。 */
let gestureBound = false;

export function useAudio(): void {
  const store = useSettingsStore();
  const { values } = storeToRefs(store);

  /** BGM 是否该响：三分支任一为 0 就停。 */
  const bgmWanted = computed(() => values.value.bgmVolume > 0 && values.value.masterVolume > 0);

  function syncBgm(): void {
    if (isAudioMuted()) return;
    if (bgmWanted.value) startBgm();
    else stopBgm();
  }

  watch(
    values,
    (v) => {
      applyVolumes(v);
      syncBgm();
    },
    { deep: true, immediate: true },
  );

  if (gestureBound || typeof window === "undefined") return;
  gestureBound = true;

  const onGesture = (): void => {
    if (!unlockAudio()) return;
    // 解锁成功后这两个监听就没用了：立即移除，不留常驻闭包（也别用 once:true ——
    // 第一次手势若解锁失败，监听被一并移除就再也没有解锁机会了）
    window.removeEventListener("pointerdown", onGesture, { capture: true });
    window.removeEventListener("keydown", onGesture, { capture: true });
    syncBgm();
  };
  window.addEventListener("pointerdown", onGesture, { capture: true });
  window.addEventListener("keydown", onGesture, { capture: true });
}

/** 设置页「试听音乐」用：已经响着就当成停（一个按钮管开停）。 */
export function toggleBgmPreview(): boolean {
  // 点击本身就是手势：先解锁，否则第一次点只会静默返回
  unlockAudio();
  if (isBgmPlaying()) {
    stopBgm();
    return false;
  }
  startBgm();
  return isBgmPlaying();
}
