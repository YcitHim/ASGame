# combat/ · 战斗状态机

## 职责
回合相位流转 + reduce 主循环入口：`(state, action) → { state', events[] }`。

## 待做清单
- [x] 相位机：battleStart → turnStart → draw → playerAction → enemyAction → turnEnd → battleEnd 全通
- [x] 相位切换全部发事件；Buff tick 按 docs/03 §3 顺序（触发器调度 S4 强化链接入）
- [x] 战斗开始组装：状态初始化、分流 RNG、洗牌、固有词条优先起手
- [x] 胜负判定与 `BattleEnded`（含奖励种子）
- [~] 多敌人管理：目标选择器 + 死亡移除已通；召唤位顺延 0.5

## 约束
- 相位内动作插队走 `pipeline/` 的栈式队列，本模块不自己维护队列
- 敌人行动逻辑（意图执行）在本模块，意图**生成**在 `intents/`
