# data/ · 全部内容数据

> 加内容 = 改这里。规范：docs/04（JSON 模板、注册制、校验规则）。
> 所有 JSON 过 `tools/content-validator` 后才算完成。

## 子目录

| 目录 | 内容 | 0.1 目标量 |
|---|---|---|
| `cards/bloodwright/` | 血械侍僧卡池 | 30 张（攻12/技12/义体6） |
| `cards/_shared/` | 通用卡（打击、防御等） | 起始卡组 10 张 |
| `enhancements/` | 卡牌专精强化 | T1×3 + T2「低血沸腾」样板 |
| `enemies/` | 敌人 + 意图表 | 5 小怪 + 1 精英 + 1 Boss |
| `relics/` | 遗物 | 4 个（血械侍僧专属） |
| `events/` | 随机事件 | 0.1 占位，0.5 铺 20+ |
| `acts/` | 关卡/地图定义 | 线性 5 节点 |
| `i18n/` | 文案（zh-CN 默认） | 全部内容文案 key |

## 纪律

- 文案一律 i18n key，JSON 不写死中文（ADR 见 docs/04 §2）
- 引用（handler/condition/target/卡牌 id/资源路径）必须真实存在，校验器兜底
- 开发期改 JSON 即时生效（G5 热更新）
