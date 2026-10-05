# rng/ · 分流种子随机

## 职责
全项目唯一的随机来源。回放、每日挑战、bug 复现的地基（ADR-006）。

## 流划分

| 流 | 用途 |
|---|---|
| `combat` | 发牌、洗牌、意图抽取、战斗内一切随机 |
| `reward` | 卡奖、遗物掉落、强化三选一 |
| `map` | 地图生成 |
| `ai` | 无头模拟器的 AI 决策 |
| `fx` | 纯表现层抖动等（不影响逻辑） |

## 待做清单
- [x] 种子算法选型：mulberry32 状态机 + fnv1a/splitmix32 流派生（纯整数，可序列化）
- [x] 流派生：`rootSeed + streamName → 独立流`，互不污染（有单测）
- [x] API：`nextInt(min,max) / nextFloat() / pick(arr) / shuffle(arr) / weighted(entries)`
- [x] **洗牌必须走本模块**（`RngStream.shuffle` 为唯一入口）
- [x] 流状态可快照/恢复（`RngStream.snapshot / Rng.fromSnapshot`，有单测）

## 约束
- 任一流内部逻辑变更不得影响其他流的序列——这是改地图不废回放的关键
