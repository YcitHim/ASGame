# triggers/ · 触发器系统

## 职责
统一调度"什么时候谁响应谁"。卡牌、Buff、遗物、强化都往这里挂钩子。

## 时机表（v0）

`onBattleStart / onTurnStart / onDraw / onPlay / onHit / onDamaged / onKill / onBlock / onHeal / onSell（卖血） / onPollutionChange / onCharge / onOverload / onTurnEnd / onBattleEnd`

## 待做清单
- [ ] 触发器注册接口：`{ source, timing, condition?, priority?, handler }`
- [ ] 同时机多触发器排序：当前约定**注册序**（docs/03 §4 待拍板项）
- [ ] 触发结果 = 新动作压栈（不直接改状态）
- [ ] 触发循环保护：同一事件链深度上限，超限报错（防"灵异死循环"）

## 约束
- handler 产出动作，不做结算；结算永远在 pipeline
- 每个时机至少一个单测锚定其触发点
