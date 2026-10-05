# intents/ · 敌人意图 AI

## 职责
敌人每回合行动后生成下回合意图，UI 全程图标展示——魂系"读招"的卡牌化。

## 意图表结构（数据驱动，存 data/enemies）

- 权重随机 + 条件分支（HP 阈值、回合数、玩家状态）
- 意图类型：`attack{n} / defend{n} / debuff{id} / charge（蓄力大招） / summon / unknown`
- **蓄力链（docs/18）**：charge 的 `thenIntent` 可嵌套，形成 蓄 →（可再蓄）→ 释放；
  `buildChargeChain` 在生成期把整条链展开成 `IntentPayload[]`——
  释放值 = 末端攻击 value + Σ(各环 charge value)，Boss 用 `releaseOverride` 写死；
  蓄力环可带 `block`（预告回合格挡）。释放后层数即消耗，**不用永久力量**。
- 蓄力链的剩余环节存 `EnemyState.forcedChain`，每回合揭示一环，不走随机。
- **预留字段**（0.1 不实现，结构别堵死）：多段行动、阶段转换（Boss P2 换意图表）、召唤

## 待做清单
- [x] 意图生成器：按意图表 + combat RNG 流抽取，发 `IntentRevealed` 事件
- [x] 意图执行器：enemyAction 相位把意图翻译为伤害/格挡/施 Buff/蓄力
- [x] 连续同一意图限制：意图表 `maxConsecutive`，条件全过滤时自动放宽
- [x] 蓄力链（0.5 P2 前置）：链长按敌型（法术 2 / 物理 1），校验器强制链尾为攻击
- [~] 0.1 敌人：已落 3 种（锈蚀猎犬 / 污染布道者 / 铁锈傀儡）；5 小怪 + 精英 + Boss 在 S5 补齐

## 约束
- 意图生成只消费 combat RNG 流，不得触碰 reward/map 流