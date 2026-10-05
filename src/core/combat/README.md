# combat/ · 战斗状态机

## 职责
回合相位流转 + reduce 主循环入口：`(state, action) → { state', events[] }`。

## 待做清单
- [~] 相位机：battleStart → turnStart → draw → playerAction 已通；enemyAction / battleEnd 在 S3
- [~] 相位切换发事件（TurnStarted/TurnEnded/CardsDrawn/BattleStarted 已发）；触发器调度 S3
- [x] 战斗开始组装：状态初始化、分流 RNG、洗牌发初始手牌
- [ ] 胜负判定与 `BattleEnded`（含奖励种子）—— S3
- [ ] 多敌人管理：召唤位、死亡移除、目标重定向 —— S3

## 约束
- 相位内动作插队走 `pipeline/` 的栈式队列，本模块不自己维护队列
- 敌人行动逻辑（意图执行）在本模块，意图**生成**在 `intents/`
