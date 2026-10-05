# systems/ · 基础服务层

> 被 UI 调用，不反向依赖 core 的结算逻辑（存档内容除外）。

## save/ · 存档
- [x] localStorage 封装 + 命名空间 key（`rustandblood:*`）
- [x] **version 字段 + migration 链（ADR-008）** —— 骨架已落地，S5 接进度/卡组/RNG 快照
- [ ] 存档内容：设置项 / 当前进度 / 卡组实例（含强化）/ RNG 流快照 / 回放输入流
- [ ] 0.5 预留云端存档接口位

## audio/ · 音频
- [ ] Howler.js 封装：BGM / 音效双通道，音量设置接入
- [ ] 0.1 音效清单：出牌、命中、受伤、格挡、UI 点击、胜负

## assets/ · 资源加载
- [ ] 占位图加载与缓存
- [ ] 0.5/1.0 预留：分包 / 懒加载（首屏 < 3s 目标的挂载点）

## debug/ · 调试控制台（G4，W3 必须可用）
- [ ] 指令：`give card <id>` / `set hp <n>` / `set energy <n>` / `add buff <id> <stacks>` / `goto node <id>` / `seed <n>`
- [ ] 战斗日志面板：实时渲染事件流（含 DamageDealt 修饰层明细）
- [ ] 队列可视化：效果栈当前挂起动作
- [ ] 仅开发构建注入；**所有 bug 复现步骤用控制台指令描述**（团队约定）
