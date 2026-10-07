import type { ZodType } from "zod";
import {
  actSchema,
  cardSchema,
  classSchema,
  enemySchema,
  enhancementSchema,
  eventSchema,
  relicSchema,
  traitSchema,
  type ActJson,
  type CardJson,
  type ClassJson,
  type EnemyJson,
  type EnhancementJson,
  type EventJson,
  type RelicJson,
  type TraitJson,
} from "./schema";

export interface SourceFile {
  /** 相对仓库根的展示路径，报错定位用 */
  file: string;
  data: unknown;
}

export interface ValidationIssue {
  file: string;
  path: string;
  message: string;
}

export interface ContentInput {
  cards: SourceFile[];
  enhancements: SourceFile[];
  enemies?: SourceFile[];
  acts?: SourceFile[];
  relics?: SourceFile[];
  events?: SourceFile[];
  classes?: SourceFile[];
  /** 职业特性（docs/58 §二） */
  traits?: SourceFile[];
  i18n: Record<string, string>;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  cards: CardJson[];
  enhancements: EnhancementJson[];
  enemies: EnemyJson[];
  acts: ActJson[];
  relics: RelicJson[];
  events: EventJson[];
  classes: ClassJson[];
  traits: TraitJson[];
}

function zodIssues(file: string, error: unknown): ValidationIssue[] {
  const err = error as { issues?: { path: (string | number | symbol)[]; message: string }[] };
  const issues = err.issues ?? [];
  return issues.map((i) => ({
    file,
    path: i.path.length ? i.path.map(String).join(".") : "(root)",
    message: i.message,
  }));
}

/**
 * docs/45 Q11：正式内容数据里**不允许**出现 core 的调试指令串。
 * `intent` 是教学脚本专用的钉意图指令（TutorialStep.intent），只能活在 src/ui/tutorial.ts；
 * 一旦有人把它写进敌人/关卡/事件 JSON（调试残留或"正式内容作弊"），构建期直接报错。
 */
/**
 * 身份指纹（docs/56 §二）：validator 的显式注册表。
 *
 * 分组的唯一标准是**机制身份**，不是风味（名字/文案带蒸汽或锈味不算）。
 * 卡面三面（本体 / 升级 / 能力）任一命中即算——所以升级面加的身份机制也会被抓到。
 */
interface CardFace {
  readonly effects: readonly { kind?: string; buff?: string; valueKind?: string; condition?: { type?: string } }[];
  readonly keywords: readonly string[];
  readonly bloodCost: number;
  readonly chargeCost: number;
  readonly powerTimings: readonly string[];
}

function cardFace(card: {
  keywords?: readonly string[];
  bloodCost?: number;
  chargeCost?: number;
  effects?: unknown;
  power?: { timing?: string; effects?: unknown };
  upgraded?: {
    keywords?: readonly string[];
    bloodCost?: number;
    effects?: unknown;
    power?: { timing?: string; effects?: unknown };
  };
}): CardFace {
  const faces = [card, card.upgraded].filter((x): x is NonNullable<typeof x> => !!x);
  const asEffects = (v: unknown): CardFace["effects"] =>
    (v as CardFace["effects"] | undefined) ?? [];
  return {
    effects: faces.flatMap((x) => [...asEffects(x.effects), ...asEffects(x.power?.effects)]),
    keywords: faces.flatMap((x) => x.keywords ?? []),
    bloodCost: Math.max(card.bloodCost ?? 0, card.upgraded?.bloodCost ?? 0),
    chargeCost: card.chargeCost ?? 0,
    powerTimings: faces.flatMap((x) => (x.power?.timing ? [x.power.timing] : [])),
  };
}

const hasBuff = (f: CardFace, ids: readonly string[]): boolean =>
  f.effects.some((e) => e.kind === "applyBuff" && !!e.buff && ids.includes(e.buff));
const hasCondition = (f: CardFace, types: readonly string[]): boolean =>
  f.effects.some((e) => !!e.condition?.type && types.includes(e.condition.type));
const hasKind = (f: CardFace, kinds: readonly string[]): boolean =>
  f.effects.some((e) => !!e.kind && kinds.includes(e.kind));

const IDENTITY_FINGERPRINTS: Record<string, (f: CardFace) => boolean> = {
  bloodwright: (f) =>
    f.keywords.includes("bloodpact") ||
    f.bloodCost > 0 ||
    hasCondition(f, ["hpBelow", "tookDamageThisTurn"]) ||
    hasKind(f, ["heal", "consumeBoons"]) ||
    hasBuff(f, ["mending"]),
  engineer: (f) =>
    hasKind(f, ["gainCharge", "spendCharge", "chargeFromEnergy", "clampCharge"]) ||
    f.chargeCost > 0 ||
    hasCondition(f, ["chargeAtLeast"]) ||
    hasBuff(f, ["tenacity", "stun"]) ||
    f.powerTimings.includes("onGainCharge"),
  rustspeaker: (f) =>
    hasKind(f, ["gainPollution", "transferPollution", "consumeCorroding", "spendPollution"]) ||
    hasCondition(f, ["pollutionAtLeast", "targetHasBuff"]) ||
    hasBuff(f, ["corroding", "burn", "reverse", "regeneration"]) ||
    f.powerTimings.includes("onPollutionMax") ||
    f.effects.some((e) => e.kind === "gainModifier" && e.valueKind === "backlashTaken"),
};

const DEBUG_COMMAND_PATTERN =
  /^(noop$|set (hp|energy) \d|add buff \S+|give card \S+|draw \d|kill \S+|seed \d|intent \S+)/;

function scanDebugCommands(
  file: string,
  data: unknown,
  issues: ValidationIssue[],
  path = "",
): void {
  if (typeof data === "string") {
    if (DEBUG_COMMAND_PATTERN.test(data.trim())) {
      issues.push({
        file,
        path: path || "(root)",
        message: `正式内容里出现调试指令串「${data}」——intent / give card 等只允许教学脚本调用`,
      });
    }
    return;
  }
  if (Array.isArray(data)) {
    data.forEach((value, index) =>
      scanDebugCommands(file, value, issues, path ? `${path}.${index}` : String(index)),
    );
    return;
  }
  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      scanDebugCommands(file, value, issues, path ? `${path}.${key}` : key);
    }
  }
}

function parseAll<T>(schema: ZodType<T>, files: SourceFile[], out: T[], issues: ValidationIssue[]): void {
  for (const f of files) {
    const result = schema.safeParse(f.data);
    if (result.success) out.push(result.data);
    else issues.push(...zodIssues(f.file, result.error));
  }
}

/** 纯函数：不碰文件系统，便于单测与 CI 复用。 */
export function validateContent(input: ContentInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  const cards: CardJson[] = [];
  const enhancements: EnhancementJson[] = [];
  const enemies: EnemyJson[] = [];
  const acts: ActJson[] = [];
  const relics: RelicJson[] = [];
  const events: EventJson[] = [];
  const classes: ClassJson[] = [];
  const traits: TraitJson[] = [];

  // docs/45 Q11：先扫一遍调试指令（正式内容数据不许引用）
  for (const file of [
    ...input.cards,
    ...input.enhancements,
    ...(input.enemies ?? []),
    ...(input.acts ?? []),
    ...(input.relics ?? []),
    ...(input.events ?? []),
    ...(input.classes ?? []),
    ...(input.traits ?? []),
  ]) {
    scanDebugCommands(file.file, file.data, issues);
  }

  parseAll(cardSchema, input.cards, cards, issues);
  parseAll(enhancementSchema, input.enhancements, enhancements, issues);
  parseAll(enemySchema, input.enemies ?? [], enemies, issues);
  parseAll(actSchema, input.acts ?? [], acts, issues);
  parseAll(relicSchema, input.relics ?? [], relics, issues);
  parseAll(eventSchema, input.events ?? [], events, issues);
  parseAll(classSchema, input.classes ?? [], classes, issues);
  parseAll(traitSchema, input.traits ?? [], traits, issues);

  // 全局 id 唯一（docs/04 §4）
  const seen = new Map<string, string>();
  const checkId = (kind: string, id: string): void => {
    const prev = seen.get(id);
    if (prev) issues.push({ file: kind + " " + id, path: "id", message: `id "${id}" 与 ${prev} 重复` });
    else seen.set(id, kind + " " + id);
  };
  for (const c of cards) checkId("card", c.id);
  for (const e of enhancements) checkId("enhancement", e.id);
  for (const e of enemies) checkId("enemy", e.id);
  for (const a of acts) checkId("act", a.id);

  // 蓄力规范（docs/16 + docs/18）：链必须最终落到带正伤害的攻击；链长 ≤ 3（法术 2 / 物理 1）；
  // 无 releaseOverride 的链必须能按「普攻 + 蓄力值 × 层数」算出释放值。
  // 没有后续招式的蓄力 = 怪只会"默默变强"，玩家看不到兑现（2026-10-05 实机 bug）。
  const MAX_CHARGE_LAYERS = 3;
  for (const e of enemies) {
    e.intents.forEach((entry, i) => {
      const root = entry.intent;
      const path = `intents.${i}.intent`;
      if (root.kind !== "charge") {
        if (root.block !== undefined || root.releaseOverride !== undefined || root.thenIntent !== undefined) {
          issues.push({
            file: `enemy ${e.id}`,
            path,
            message: "block / releaseOverride / thenIntent 只能出现在蓄力招式上",
          });
        }
        return;
      }

      let link = root.thenIntent;
      let layers = 1;
      const links = [root];
      while (link && link.kind === "charge") {
        links.push(link);
        layers += 1;
        link = link.thenIntent;
      }
      if (layers > MAX_CHARGE_LAYERS) {
        issues.push({
          file: `enemy ${e.id}`,
          path,
          message: `蓄力链最长 ${MAX_CHARGE_LAYERS} 环（docs/18：法术 2 / 物理 1，不写无限链）`,
        });
        return;
      }
      const terminal = link;
      if (!terminal || terminal.kind !== "attack" || !terminal.value || terminal.value <= 0) {
        issues.push({
          file: `enemy ${e.id}`,
          path,
          message: "蓄力链末端必须是带正伤害值的攻击（docs/18 Q1）",
        });
        return;
      }
      if (root.releaseOverride === undefined) {
        const missing = links.find((l) => l.value === undefined);
        if (missing) {
          issues.push({
            file: `enemy ${e.id}`,
            path,
            message: "无 releaseOverride 的蓄力链，每一环都必须声明 value（用于叠加公式）",
          });
        }
      }
    });
  }
  // 意图标签可读性（docs/41 §2.2）：debuff 意图必须声明具体减益 id，
  // 否则 UI 只能兜底「干扰」——玩家会看到与实际行为不符的提示。
  for (const e of enemies) {
    e.intents.forEach((entry, i) => {
      const walk = (intent: typeof entry.intent, path: string): void => {
        if (intent.kind === "debuff" && !intent.buffId) {
          issues.push({
            file: `enemy ${e.id}`,
            path,
            message: "debuff 意图必须声明 buffId（docs/41 §2.2：意图标签要显示实际减益名）",
          });
        }
        if (intent.thenIntent) walk(intent.thenIntent, `${path}.thenIntent`);
      };
      walk(entry.intent, `intents.${i}.intent`);
    });
  }
  for (const r of relics) checkId("relic", r.id);
  for (const e of events) checkId("event", e.id);
  for (const c of classes) checkId("class", c.id);
  for (const t of traits) checkId("trait", t.id);

  // 九相后半（docs/46 §3.5 / §六.8）：眩晕的两条硬约束
  for (const e of enemies) {
    // docs/47 §三：减益也可以挂在攻击上（链枷手「震慑重击」= 蓄力链释放段命中附加眩晕），
    // 所以这里只认 buffId，不限定 kind——否则攻击携带的眩晕会绕过预告约束。
    const appliesStun = e.intents.some((entry) => {
      let cursor: typeof entry.intent | undefined = entry.intent;
      while (cursor) {
        if (cursor.buffId === "stun") return true;
        cursor = cursor.thenIntent;
      }
      return false;
    });
    if (!appliesStun) continue;
    // 预告形式二选一（docs/47 §二.1）：蓄力链，或 everyTurns 节拍（玩家数得出来第几回合挨）
    const hasCharge = e.intents.some((entry) => entry.intent.kind === "charge");
    const hasBeat = e.intents.some((entry) => {
      if (entry.everyTurns == null) return false;
      let cursor: typeof entry.intent | undefined = entry.intent;
      while (cursor) {
        if (cursor.buffId === "stun") return true;
        cursor = cursor.thenIntent;
      }
      return false;
    });
    if (!hasCharge && !hasBeat) {
      issues.push({
        file: `enemy ${e.id}`,
        path: "intents",
        message: "对玩家施加眩晕必须提前预告（蓄力链或 everyTurns 节拍，docs/46 §3.5 / docs/47 §二.1）",
      });
    }
  }
  // 分裂亡语（docs/47 §三.4，M3 已解锁）：唯一的硬规则是「分裂物不再分裂」——禁止自指与链式分裂
  for (const e of enemies) {
    if (e.onDeathSplit?.enemyId === e.id) {
      issues.push({
        file: `enemy ${e.id}`,
        path: "onDeathSplit",
        message: "分裂物不能是自己（会无限分裂，docs/47 §四.2）",
      });
    }
  }
  // 开场状态只允许挂「加持/异常」类，不许拿它绕过召唤等其它机制
  for (const e of enemies) {
    for (const sb of e.startBuffs ?? []) {
      if (sb.buffId === "pollution") {
        issues.push({
          file: `enemy ${e.id}`,
          path: "startBuffs",
          message: "开场状态不允许挂 pollution（那是玩家侧资源，敌人没有）",
        });
      }
    }
  }
  for (const c of cards) {
    const lists = [c.effects ?? [], c.upgraded?.effects ?? [], c.power?.effects ?? [], c.upgraded?.power?.effects ?? []];
    const appliesStun = lists.flat().some((eff) => eff.kind === "applyBuff" && eff.buff === "stun");
    if (appliesStun && c.rarity !== "rare") {
      issues.push({
        file: `card ${c.id}`,
        path: "rarity",
        message: "玩家侧眩晕只允许稀有卡持有（docs/46 §3.5）",
      });
    }
  }

  // 强化 appliesTo / mutex 引用
  const cardIds = new Set(cards.map((c) => c.id));
  const enhIds = new Set(enhancements.map((e) => e.id));
  for (const e of enhancements) {
    for (const target of e.appliesTo) {
      if (!cardIds.has(target)) {
        issues.push({ file: `enhancement ${e.id}`, path: "appliesTo", message: `引用了不存在的卡牌 "${target}"` });
      }
    }
    for (const other of e.mutex ?? []) {
      if (!enhIds.has(other)) {
        issues.push({ file: `enhancement ${e.id}`, path: "mutex", message: `互斥指向不存在的强化 "${other}"` });
      }
    }
  }

  // act 引用：起手卡组与遭遇敌人
  const enemyIds = new Set(enemies.map((e) => e.id));
  const relicIds = new Set(relics.map((r) => r.id));
  const eventIds = new Set(events.map((e) => e.id));
  // 分裂亡语的引用完整性与「不再分裂」链式锁（docs/47 §四.2）
  const enemyById = new Map(enemies.map((e) => [e.id, e]));
  for (const e of enemies) {
    const split = e.onDeathSplit;
    if (!split) continue;
    if (!enemyIds.has(split.enemyId)) {
      issues.push({
        file: `enemy ${e.id}`,
        path: "onDeathSplit.enemyId",
        message: `分裂出未定义的敌人 "${split.enemyId}"`,
      });
      continue;
    }
    if (enemyById.get(split.enemyId)?.onDeathSplit) {
      issues.push({
        file: `enemy ${e.id}`,
        path: "onDeathSplit",
        message: "分裂物不再分裂（docs/47 §四.2：不可链式分裂）",
      });
    }
  }
  // 事件 gainCard 显式池引用 / 新效果取值合法性（docs/54 §三）
  for (const ev of events) {
    for (const opt of ev.options) {
      const lists = [opt.effects ?? [], ...(opt.outcomes ?? []).map((o) => o.effects)];
      for (const eff of lists.flat()) {
        for (const id of eff.pool ?? []) {
          if (!cardIds.has(id)) {
            issues.push({ file: `event ${ev.id}`, path: "opt.effects.pool", message: `引用了不存在的卡牌 "${id}"` });
          }
        }
        // E1 / E4：百分比与上限变化必须有非零数值，否则是一条不生效的假效果
        if ((eff.kind === "hpPercent" || eff.kind === "maxHp") && (eff.value ?? 0) === 0) {
          issues.push({
            file: `event ${ev.id}`,
            path: "opt.effects.value",
            message: `${eff.kind} 的 value 不能为 0`,
          });
        }
        // docs/55 Q4 军规 2 的机器看守：事件的 HP 收支除了 ≤4 的剧情性小额，
        // 一律走 hpPercent（否则「固定数值不缩放」的批评会随时复发）
        if (eff.kind === "hp" && Math.abs(eff.value ?? 0) > 4) {
          issues.push({
            file: `event ${ev.id}`,
            path: "opt.effects.value",
            message: `HP 收支 ${eff.value} 超过 ±4，必须改用 hpPercent（docs/54 军规 2 / docs/55 Q4）`,
          });
        }
      }
    }
  }

  // 甲方 2026-10-07 裁定：**事件选项文案不得剧透结果**（含赌局赔率）——
  // docs/54 §二 军规 3「赌局明示赔率」与 §三 E8 的「label 必须写出百分比」就此作废，
  // 选项标签只留风味，结果由选完之后的 result 文案揭晓。
  // 这里退化成一条更弱的守卫：赌局必须有 outcomes，且权重之和 > 0（别写出永远抽不中的死结果）。
  for (const ev of events) {
    for (const opt of ev.options) {
      const outcomes = opt.outcomes ?? [];
      if (outcomes.length === 0) continue;
      const total = outcomes.reduce((sum, o) => sum + Math.max(0, o.weight), 0);
      if (total <= 0) {
        issues.push({
          file: `event ${ev.id}`,
          path: `opt.${opt.id}.outcomes`,
          message: "赌局的 weight 之和必须 > 0",
        });
      }
    }
  }

  // docs/54 §六：事件池配比——第一幕 ≥8、其余幕 ≥6（同幕不放回，池太浅会很快重置）
  acts.forEach((act, index) => {
    const pool = new Set<string>();
    for (const layer of act.layers) for (const id of layer.events ?? []) pool.add(id);
    const min = index === 0 ? 8 : 6;
    if (pool.size > 0 && pool.size < min) {
      issues.push({
        file: `act ${act.id}`,
        path: "layers.events",
        message: `事件池至少 ${min} 个（docs/54 §六），当前 ${pool.size} 个`,
      });
    }
  });
  // 职业引用：起手卡组 / 起始遗物 / 文案；act 只声明可选职业
  const classIds = new Set(classes.map((c) => c.id));
  for (const cls of classes) {
    for (const cardId of cls.startDeck) {
      if (!cardIds.has(cardId)) {
        issues.push({ file: `class ${cls.id}`, path: "startDeck", message: `引用了不存在的卡牌 "${cardId}"` });
      }
    }
    for (const relicId of cls.startRelics ?? []) {
      if (!relicIds.has(relicId)) {
        issues.push({ file: `class ${cls.id}`, path: "startRelics", message: `引用了不存在的遗物 "${relicId}"` });
      }
    }
    requireKeyEarly(`class ${cls.id}`, cls.i18n + ".name");
    requireKeyEarly(`class ${cls.id}`, cls.i18n + ".title");
    requireKeyEarly(`class ${cls.id}`, cls.i18n + ".intro");
  }
  // 职业特性（docs/58 §二）：归属职业存在 + 文案齐全 + 每职业至少一档（防静默丢特性）
  for (const t of traits) {
    if (!classIds.has(t.classId)) {
      issues.push({ file: `trait ${t.id}`, path: "classId", message: `引用了不存在的职业 "${t.classId}"` });
    }
    requireKeyEarly(`trait ${t.id}`, t.i18n + ".name");
    requireKeyEarly(`trait ${t.id}`, t.i18n + ".desc");
  }
  for (const cls of classes) {
    if (!traits.some((t) => t.classId === cls.id)) {
      issues.push({
        file: `class ${cls.id}`,
        path: "traits",
        message: "每个职业至少要有一档特性（docs/58 §一/§二：开局三选含无特性）",
      });
    }
  }
  // 每张卡的 class 必须是已定义职业——或中立池（docs/56 §三：neutral 不是职业，是共享池）
  for (const c of cards) {
    if (c.class !== "neutral" && !classIds.has(c.class)) {
      issues.push({ file: `card ${c.id}`, path: "class", message: `未定义的职业 "${c.class}"` });
    }
  }
  for (const act of acts) {
    for (const classId of act.classes) {
      if (!classIds.has(classId)) {
        issues.push({ file: `act ${act.id}`, path: "classes", message: `引用了不存在的职业 "${classId}"` });
      }
    }
    // 分支地图层校验（docs/16 5.4）：种类合法、敌人/遭遇/事件引用存在、文案存在
    const layerIds = new Set<string>();
    for (const layer of act.layers) {
      if (layerIds.has(layer.id)) {
        issues.push({ file: `act ${act.id}`, path: "layers", message: `层 id "${layer.id}" 重复` });
      }
      layerIds.add(layer.id);
      const isMerge = layer.width === 1;
      for (const kind of layer.kinds) {
        requireKeyEarly(`act ${act.id}`, layer.i18n ?? `node.${kind}`);
      }
      // 写死敌人只允许出现在必经层（分支层的候选种类由生成器决定）
      if (!isMerge && layer.enemies && layer.enemies.length > 0) {
        issues.push({ file: `act ${act.id}`, path: `layers.${layer.id}`, message: "分支层不能写死 enemies" });
      }
      if (!isMerge && layer.kinds.some((k) => k === "elite" || k === "boss") && !layer.kinds.includes("battle")) {
        // 允许精英作为分支候选，但必须至少有一种非 Boss 类型，避免全层 Boss
        issues.push({ file: `act ${act.id}`, path: `layers.${layer.id}`, message: "分支层类型异常" });
      }
      for (const enemyId of layer.enemies ?? []) {
        if (!enemyIds.has(enemyId)) {
          issues.push({ file: `act ${act.id}`, path: `layers.${layer.id}`, message: `引用了不存在的敌人 "${enemyId}"` });
        }
      }
      for (const entry of layer.encounters ?? []) {
        for (const enemyId of entry.enemies) {
          if (!enemyIds.has(enemyId)) {
            issues.push({ file: `act ${act.id}`, path: `layers.${layer.id}`, message: `遭遇池引用了不存在的敌人 "${enemyId}"` });
          }
        }
      }
      for (const eventId of layer.events ?? []) {
        if (!eventIds.has(eventId)) {
          issues.push({ file: `act ${act.id}`, path: `layers.${layer.id}`, message: `引用了不存在的事件 "${eventId}"` });
        }
      }
    }
    // 树状骨架（docs/48 §3.1 修订 1）：10 层；起点 / 祭坛 / Boss 单节点；中段 2~4
    const total = act.layers.length;
    if (total !== 10) {
      issues.push({
        file: `act ${act.id}`,
        path: "layers",
        message: `树状地图固定 10 层（l0 起点 / l1~l7 中段 / l8 祭坛 / l9 Boss，docs/48 §3.1 修订 1），当前 ${total} 层`,
      });
    }
    act.layers.forEach((layer, i) => {
      const edgeLayer = i === 0 || i >= total - 2;
      if (edgeLayer && layer.width !== 1) {
        issues.push({
          file: `act ${act.id}`,
          path: `layers.${layer.id}`,
          message: "起点 / 祭坛 / Boss 层必须声明 width=1（docs/48 §3.1）",
        });
      }
      if (!edgeLayer && (layer.width < 2 || layer.width > 4)) {
        issues.push({
          file: `act ${act.id}`,
          path: `layers.${layer.id}`,
          message: "中段层必须声明 width 2~4（docs/48 §3.1 修订 1）",
        });
      }
      if ((i === 1 || i === total - 2) && layer.kinds.includes("elite")) {
        issues.push({
          file: `act ${act.id}`,
          path: `layers.${layer.id}`,
          message: "l1 与倒数第二层不出精英（docs/48 §3.2）",
        });
      }
    });
    if (!(act.i18n in input.i18n)) {
      issues.push({ file: `act ${act.id}`, path: "i18n", message: `文案缺失：zh-CN 无 "${act.i18n}"` });
    }
  }

  // 1.0 新机制语义（docs/38 §五.3：新机制先进 validator 再进内容）
  const ENEMY_TARGETS = new Set(["chosenEnemy", "randomEnemy", "allEnemies", "lowestHpEnemy", "highestHpEnemy"]);
  type MechanicEffect = { kind?: string; buff?: string; target?: { type: string }; value?: number };
  const checkMechanics = (file: string, effects: readonly MechanicEffect[] | undefined): void => {
    for (const e of effects ?? []) {
      const target = e.target?.type ?? "self";
      if (e.kind === "applyBuff" && e.buff === "corroding" && !ENEMY_TARGETS.has(target)) {
        issues.push({ file, path: "effects", message: "蚀锈 corroding 只能施加给敌人目标（docs/38 §二 B-2）" });
      }
      if ((e.kind === "transferPollution" || e.kind === "consumeCorroding") && !ENEMY_TARGETS.has(target)) {
        issues.push({ file, path: "effects", message: `${e.kind} 的目标必须是敌人` });
      }
      if (e.kind === "spendPollution" && (e.value ?? 0) <= 0) {
        issues.push({ file, path: "effects", message: "spendPollution 的每点结算量必须 > 0" });
      }
      if (e.kind === "consumeBoons" && (e.value ?? 0) <= 0) {
        issues.push({ file, path: "effects", message: "consumeBoons 的每层结算量必须 > 0" });
      }
    }
  };
  for (const c of cards) {
    checkMechanics(`card ${c.id}`, c.effects);
    checkMechanics(`card ${c.id} (upgraded)`, c.upgraded?.effects);
    checkMechanics(`card ${c.id} (power)`, c.power?.effects);
    checkMechanics(`card ${c.id} (power upgraded)`, c.upgraded?.power?.effects);
  }
  // docs/56 §五 分组铁律的双向守卫：中立禁纹 / 职业验纹
  for (const c of cards) {
    const face = cardFace(c as unknown as Parameters<typeof cardFace>[0]);
    if (c.class === "neutral") {
      const hit = (["bloodwright", "engineer", "rustspeaker"] as const).find((cls) =>
        IDENTITY_FINGERPRINTS[cls]!(face),
      );
      if (hit) {
        issues.push({
          file: `card ${c.id}`,
          path: "class",
          message: `中立池不得命中身份指纹（命中 ${hit}）——docs/56 §二：中立卡只能靠 damage/block/draw 与通用状态`,
        });
      }
      continue;
    }
    const check = IDENTITY_FINGERPRINTS[c.class];
    if (check && !check(face)) {
      issues.push({
        file: `card ${c.id}`,
        path: "class",
        message: `职业卡未命中本职业身份指纹（${c.class}）——docs/56 §二：身份卡不能错放他池`,
      });
    }
  }

  // 幕专属强化：actScope 必须是已定义的幕 id（docs/40 §七）
  for (const e of enhancements) {
    if (e.actScope && !acts.some((a) => a.id === e.actScope)) {
      issues.push({ file: `enhancement ${e.id}`, path: "actScope", message: `actScope "${e.actScope}" 不是已定义的幕` });
    }
  }
  for (const r of relics) checkMechanics(`relic ${r.id}`, r.effects);
  for (const e of enemies) checkMechanics(`enemy ${e.id}`, e.onDeath);

  // i18n key 存在（docs/04 §4）
  function requireKeyEarly(file: string, key: string): void {
    if (!(key in input.i18n)) issues.push({ file, path: "i18n", message: `文案缺失：zh-CN 无 "${key}"` });
  }
  const requireKey = requireKeyEarly;
  for (const c of cards) {
    const base = c.i18n ?? `card.${c.id}`;
    requireKey(`card ${c.id}`, base + ".name");
    requireKey(`card ${c.id}`, base + ".desc");
  }
  for (const e of enhancements) {
    const base = e.i18n ?? `enh.${e.id}`;
    requireKey(`enhancement ${e.id}`, base + ".name");
    requireKey(`enhancement ${e.id}`, base + ".desc");
  }
  for (const e of enemies) {
    requireKey(`enemy ${e.id}`, `enemy.${e.id}.name`);
  }
  for (const r of relics) {
    requireKey(`relic ${r.id}`, r.i18n + ".name");
    requireKey(`relic ${r.id}`, r.i18n + ".desc");
    // docs/38 §一：遗物全部含 flavor
    requireKey(`relic ${r.id}`, r.i18n + ".flavor");
  }
  // 遗物分级（docs/38 §一 A-1）：T1 起始池至少 6 件；身份件（无 tier）不入任何掉落池
  const t1 = relics.filter((r) => r.tier === 1);
  if (t1.length < 6) {
    issues.push({
      file: "relics",
      path: "tier",
      message: `T1 起始池至少 6 件（随身遗物可选项），当前 ${t1.length} 件`,
    });
  }
  for (const cls of classes) {
    for (const id of cls.startRelics ?? []) {
      const relic = relics.find((r) => r.id === id);
      if (relic && relic.tier !== undefined) {
        issues.push({
          file: `class ${cls.id}`,
          path: "startRelics",
          message: `起始配置只能是身份件（无 tier），"${id}" 是 T${relic.tier} 掉落件`,
        });
      }
    }
  }
  for (const ev of events) {
    requireKey(`event ${ev.id}`, ev.i18n + ".title");
    requireKey(`event ${ev.id}`, ev.i18n + ".body");
    for (const opt of ev.options) {
      requireKey(`event ${ev.id}`, `${ev.i18n}.opt.${opt.id}.label`);
      if (opt.i18n) requireKey(`event ${ev.id}`, opt.i18n);
      for (const outcome of opt.outcomes ?? []) requireKey(`event ${ev.id}`, outcome.i18n);
    }
  }

  return { issues, cards, enhancements, enemies, acts, relics, events, classes, traits };
}

/** 报错文本：带文件与字段定位（docs/05 G1 验收要求）。 */
export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => `  ✗ ${i.file} → ${i.path}: ${i.message}`).join("\n");
}