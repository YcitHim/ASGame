# core/ · 游戏核心（纯 TS，零 DOM）

> 玩法规则的唯一住所。规范依据：`docs/01`（ADR）、`docs/02`（状态/动作/事件）、`docs/03`（管线与时序）。

## 子模块地图

| 子目录 | 职责 | 对应规范 |
|---|---|---|
| `actions/` | 一切输入的可序列化指令 | docs/02 §3 |
| `events/` | 领域事件类型与构造器 | docs/02 §5 |
| `combat/` | 回合状态机与 reduce 主循环 | docs/02 §4 |
| `pipeline/` | 栈式效果队列 + 修饰符管线 | ADR-002 / docs/03 |
| `triggers/` | 触发时机注册与调度 | 本目录 README |
| `keywords/` | 关键词钩子实现 | ADR-004 |
| `buffs/` | Buff 结构、层数规则、结算 | docs/03 §2 |
| `intents/` | 敌人意图 AI | 本目录 README |
| `registry/` | 五类注册表总装 | ADR-004 / docs/04 |
| `rng/` | 分流种子随机 | ADR-006 |

## 硬性约束

- 主循环形态：`(state, action) → { state', events[] }`，纯函数、状态不可变
- 任何状态变更必须落成事件（带全局递增 `seq`）
- 随机只走 `rng/` 的分源流
- 每个子模块的实现完成后必须配 `tests/unit/` 下的对应测试

## 实现顺序建议（对应 W2–W3）

`rng` → `events` / `actions` → `pipeline`（修饰符求值器）→ `buffs` → `triggers` → `keywords` → `combat` → `intents` → `registry` 总装
