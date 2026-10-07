<script setup lang="ts">
import { useTemplateRef } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import EmberField from "@/ui/components/EmberField.vue";
import { useStageFit } from "@/ui/composables/useStageFit";
import { type Settings, useSettingsStore } from "@/stores/settings";
import { useTutorialStore } from "@/stores/tutorial";

const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);
const router = useRouter();
const store = useSettingsStore();
const { values } = storeToRefs(store);

interface VolumeRow {
  key: keyof Pick<Settings, "masterVolume" | "bgmVolume" | "sfxVolume">;
  label: string;
  hint: string;
}

const volumes: VolumeRow[] = [
  { key: "masterVolume", label: "主音量", hint: "全局总闸" },
  { key: "bgmVolume", label: "音乐", hint: "BGM 通道" },
  { key: "sfxVolume", label: "音效", hint: "出牌 / 命中 / UI" },
];

function onVolume(key: VolumeRow["key"], event: Event): void {
  const value = Number((event.target as HTMLInputElement).value) / 100;
  store.update({ [key]: value });
}

function onToggle(key: "developerMode", event: Event): void {
  store.update({ [key]: (event.target as HTMLInputElement).checked });
}

function onBattleAnim(value: Settings["battleAnim"]): void {
  store.update({ battleAnim: value });
}

function onSpeed(event: Event): void {
  const speed = Number((event.target as HTMLInputElement).value) === 2 ? 2 : 1;
  store.update({ animationSpeed: speed as Settings["animationSpeed"] });
}

/** 重看教学（docs/41 §4.3）：从设置页随时重进。 */
function replayTutorial(): void {
  useTutorialStore().begin();
  void router.push("/tutorial");
}

function back(): void {
  void router.push("/");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage settings-stage">
      <EmberField />

      <header class="bar">
        <button class="etch-btn back" @click="back">← 返回</button>
        <h2>设 置</h2>
        <span class="spacer" />
      </header>

      <section class="panel">
        <h3 class="group">音频</h3>
        <div v-for="row in volumes" :key="row.key" class="row">
          <div class="label">
            <b>{{ row.label }}</b>
            <small>{{ row.hint }}</small>
          </div>
          <input
            class="slider"
            type="range"
            min="0"
            max="100"
            :value="Math.round(values[row.key] * 100)"
            @input="onVolume(row.key, $event)"
          />
          <span class="num">{{ Math.round(values[row.key] * 100) }}</span>
        </div>

        <h3 class="group">反馈</h3>
        <div class="row">
          <div class="label">
            <b>战斗动画</b>
            <small>完整＝前扑/屏震/飘字；简化＝仅飘字；关闭＝全关</small>
          </div>
          <div class="speeds">
            <label
              ><input
                type="radio"
                name="battle-anim"
                :checked="values.battleAnim === 'full'"
                @change="onBattleAnim('full')"
              />
              完整</label
            >
            <label
              ><input
                type="radio"
                name="battle-anim"
                :checked="values.battleAnim === 'simple'"
                @change="onBattleAnim('simple')"
              />
              简化</label
            >
            <label
              ><input
                type="radio"
                name="battle-anim"
                :checked="values.battleAnim === 'off'"
                @change="onBattleAnim('off')"
              />
              关闭</label
            >
          </div>
        </div>
        <div class="row">
          <div class="label"><b>动画倍速</b><small>跳过 / 2× 消费事件流</small></div>
          <div class="speeds">
            <label><input type="radio" name="speed" :checked="values.animationSpeed === 1" value="1" @change="onSpeed" /> 1×</label>
            <label><input type="radio" name="speed" :checked="values.animationSpeed === 2" value="2" @change="onSpeed" /> 2×</label>
          </div>
        </div>

        <h3 class="group">教学</h3>
        <div class="row">
          <div class="label">
            <b>重看教学</b>
            <small>随时重进三场演武；教学不发奖励，只是带路</small>
          </div>
          <button class="etch-btn" @click="replayTutorial">进 入 教 学</button>
        </div>

        <h3 class="group">开发者</h3>
        <div class="row">
          <div class="label">
            <b>开发者模式</b>
            <small>解锁全部职业与内容，并在选人 / 地图页露出跳关入口（仅供测试）</small>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              :checked="values.developerMode"
              @change="onToggle('developerMode', $event)"
            />
            <span>{{ values.developerMode ? "开" : "关" }}</span>
          </label>
        </div>

        <h3 class="group">语言</h3>
        <div class="row">
          <div class="label"><b>界面语言</b><small>i18n key 已就位，0.1 暂锁中文</small></div>
          <span class="locked">简体中文</span>
        </div>

        <div class="actions">
          <button class="etch-btn" @click="store.reset()">恢复默认</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 34px 0;
}

.bar {
  position: relative;
  z-index: 2;
  width: 760px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bar h2 {
  font-family: var(--serif-title);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.4em;
  color: var(--ink-bone);
}

.back {
  padding: 8px 16px;
  font-size: 12px;
  letter-spacing: 0.16em;
}

.spacer {
  width: 96px;
}

.panel {
  position: relative;
  z-index: 2;
  width: 620px;
  margin-top: 26px;
  padding: 8px 26px 22px;
  background: rgba(18, 16, 14, 0.82);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-sm);
  box-shadow: var(--panel-shadow);
}

.group {
  margin: 20px 0 10px;
  font-size: 11px;
  letter-spacing: 0.34em;
  color: var(--gold);
  font-weight: 400;
  border-bottom: 1px solid rgba(110, 88, 54, 0.35);
  padding-bottom: 6px;
}

.row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 9px 0;
}

.label {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.label b {
  font-size: 14px;
  font-weight: 400;
  color: var(--ink-bone);
  letter-spacing: 0.08em;
}

.label small {
  font-size: 10px;
  color: var(--ink-dim);
}

.slider {
  width: 240px;
  accent-color: var(--gold);
}

.num {
  width: 32px;
  text-align: right;
  font-family: var(--serif-num);
  color: var(--gold);
  font-size: 14px;
}

.switch {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-dim);
  cursor: pointer;
}

.switch input,
.speeds input {
  accent-color: var(--blood-hi);
}

.speeds {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--ink-dim);
}

.speeds label {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.locked {
  font-size: 12px;
  color: var(--ink-dim);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-sm);
  padding: 3px 10px;
}

.actions {
  margin-top: 22px;
  display: flex;
  justify-content: flex-end;
}

.actions .etch-btn {
  padding: 9px 18px;
  font-size: 12px;
}
</style>