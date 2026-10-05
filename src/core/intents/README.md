# intents/ · 敌人意图 AI

## 职责
敌人每回合行动后生成下回合意图，UI 全程图标展示——魂系"读招"的卡牌化。

## 意图表结构（数据驱动，存 data/enemies）

- 权重随机 + 条件分支（HP 阈值、回合数、玩家状态）
- 意图类型：`attack{n} / defend{n} / debuff{id} / charge（蓄力大招） / summon / unknown`
- **预留字段**（0.1 不实现，结构别堵死）：多段行动、阶段转换（Boss P2 换意图表）、召唤

## 待做清单
- [ ] 意图生成器：按意图表 + combat RNG 流抽取，发 `IntentRevealed` 事件
- [ ] 意图执行器：enemyAction 相位把意图翻译为动作压栈
- [ ] 连续同一意图的限制规则（如"同一意图最多连续 2 次"，写在意图表里）
- [ ] 0.1 敌人：5 小怪 + 1 精英 + 1 Boss（污染主题，给玩家施污染压力）

## 约束
- 意图生成只消费 combat RNG 流，不得触碰 reward/map 流
