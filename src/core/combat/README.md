# combat/ · 战斗状态机

## 职责
回合相位流转 + reduce 主循环入口：`(state, action) → { state', events[] }`。

## 待做清单
- [ ] 相位机：`battleStart → turnStart → draw → playerAction → enemyAction → turnEnd → battleEnd`（docs/02 §4）
- [ ] 相位切换全部发事件；触发器按相位+时机调度
- [ ] 战斗开始组装：读玩家卡组实例、敌人配置、初始化分流 RNG
- [ ] 胜负判定与 `BattleEnded`（含奖励种子）
- [ ] 多敌人管理：召唤位、死亡移除、目标重定向

## 约束
- 相位内动作插队走 `pipeline/` 的栈式队列，本模块不自己维护队列
- 敌人行动逻辑（意图执行）在本模块，意图**生成**在 `intents/`
