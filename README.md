# 锈与血（暂名）· H5 肉鸽卡牌

[![CI](https://github.com/YOUR_GITHUB/rust-and-blood/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_GITHUB/rust-and-blood/actions/workflows/ci.yml)

> 当前状态：**S6 打磨与封版**（golden replay 进 CI、打击感参数、0.1 数值锚定）。策划拍板已全部落实，详见 docs/12。
> 推进基准：`docs/09-阶段任务分解.md`（阶段出口门禁全绿才前进），先读 `docs/`（尤其 01/02/03）。
> 内容编辑入口：`src/data/`（卡牌 / 强化 / 遗物 / 敌人 / 关卡 / 文案，全部 JSON + validator）。

## 开发命令

```bash
npm install        # 安装依赖
npm run dev        # 本地开发（Vite，默认 http://localhost:5173）
npm run build      # 类型检查 + 生产构建
npm run lint       # ESLint（含 G3：core 禁 Math.random / Date.now / UI 依赖）
npm run validate   # content-validator（G1：data JSON schema + 引用存在性）
npm test           # Vitest 单测
npm run test:coverage  # 单测 + 覆盖率（门禁：pipeline ≥ 90%）
npm run sim -- 100 # 无头模拟器（G6）：跑 100 局线性地图，产出胜率/回合/伤害/抓用率报表
npm run ci         # lint → typecheck → validate → test:coverage → sim 100（CI 同款）
```

## 目录导航

| 位置 | 内容 |
|---|---|
| `docs/` | 设计规范与架构决策（地基，先读） |
| `src/core/` | 游戏核心（纯 TS，禁 DOM）——每个子目录的 README 即制作清单 |
| `src/data/` | 全部内容数据：卡牌 / 强化 / 敌人 / 遗物 / 事件 / 关卡 / 文案 |
| `src/systems/` | 基础服务：存档、音频、资源加载、调试控制台 |
| `src/ui/` | Vue 表现层：页面、组件、动画队列 |
| `src/stores/` | Pinia：核心状态在 UI 侧的投影（不含数值逻辑） |
| `tests/` | 单元测试 + Golden Replay 回归 |
| `tools/` | 内容校验器 / 无头模拟器 / 回放查看器 |

## 六条铁律（写任何代码前必读）

1. 玩法规则只存在于 `src/core`，UI 只做展示与输入转发
2. 核心层状态变更只通过**领域事件流**对外暴露（docs/02）
3. 一切数值计算走**修饰符管线**，禁止直接改写基础值（docs/03）
4. 一切随机走**分流种子 RNG**；core 内禁 `Math.random` / `Date.now`
5. 新内容 = 新 JSON / 新注册项，不改核心代码
6. 条件、目标、卡牌逻辑一律走**注册表**，禁止字符串特判（docs/04）

## 决策状态

- [x] **移动端方向**（docs/01 ADR-007）：2026-10-05 拍板**锁定横屏 + 旋转提示**（方案 A）
- [x] **玩家格挡清零 / 污染满值反噬 / 触发器优先级**（docs/03 §4）：同日全部拍板，⚠️ 已清零
