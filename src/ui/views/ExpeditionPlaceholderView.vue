<script setup lang="ts">
import { useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import EmberField from "@/ui/components/EmberField.vue";
import { useStageFit } from "@/ui/composables/useStageFit";

const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);
const router = useRouter();
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage placeholder-stage">
      <EmberField />
      <div class="box">
        <h2>远征途中 · 核心层未接入</h2>
        <p>
          S1 只交付工程地基与标题/设置。战斗界面将在
          <b>S2 核心骨架 → S3 战斗可玩</b> 阶段接入，
          届时按 <code>docs/mockups/battle-screen.html</code> 基准实现。
        </p>
        <button class="etch-btn" @click="router.push('/')">返回标题</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.placeholder-stage {
  display: flex;
  align-items: center;
  justify-content: center;
}

.box {
  position: relative;
  z-index: 2;
  width: 560px;
  padding: 28px 30px;
  text-align: center;
  background: rgba(18, 16, 14, 0.85);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-sm);
  box-shadow: var(--panel-shadow);
}

.box h2 {
  font-family: var(--serif-title);
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.2em;
  color: var(--ink-bone);
}

.box p {
  margin: 18px 0 24px;
  font-size: 13px;
  line-height: 1.9;
  color: var(--ink-dim);
}

.box b {
  color: var(--gold);
  font-weight: 400;
}

.box code {
  font-family: var(--serif-title);
  color: var(--blood-hi);
}

.box .etch-btn {
  padding: 10px 22px;
  font-size: 13px;
}
</style>