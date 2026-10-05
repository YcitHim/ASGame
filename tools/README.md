# tools/ · 工程工具链

> 地基投资的另一半。规范：docs/05。

## content-validator/ · 内容校验器（G1，W1）
- [x] zod/schema 定义 data JSON 结构（卡牌 / 强化已落地；敌人 / 遗物 S4-S5 补）
- [~] 校验规则清单：docs/04 §4 —— id 唯一、引用存在（keyword/condition/target/handler）、i18n key、数值范围已实现；资源路径待有 art 字段后补
- [x] 接入 CI（npm run validate）；报错带文件路径与字段定位

## headless-sim/ · 无头模拟器（G6，W5 跑通）
- [x] Node 直跑 core + data（零 DOM 红利，`npm run sim -- 100`）
- [x] 最简启发式 AI：能出牌就出、优先攻击、低血会防、血契致死回避
- [x] 批量 N 局报表：胜率、平均回合（P50/P90）、伤害分布、到达节点分布、抓牌/出牌/强化 Top
- [x] 0.1 验收：100 局线性地图胜率 58%（初版 100% → 按报表加强敌人、削减起始遗物后落回区间）

## replay-viewer/ · 回放查看器（可选，0.5+）
- [ ] 加载回放文件，步进查看每事件后的状态
- [ ] 与 golden-replays 共用格式

## CI 最小流水线（W1）

```
lint（含 G3 确定性规则）→ content-validator → vitest → golden replay 重放
```
