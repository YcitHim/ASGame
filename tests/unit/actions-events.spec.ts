import { describe, expect, it } from "vitest";
import { isRoundTrippable, type Action } from "@/core/actions";
import { EventSink } from "@/core/events";

const ALL_ACTIONS: Action[] = [
  { type: "PlayCard", actionId: "a1", handIndex: 2, targetId: "enemy-1" },
  { type: "EndTurn", actionId: "a2" },
  { type: "SelectReward", actionId: "a3", optionIndex: 1 },
  { type: "ChooseMapNode", actionId: "a4", nodeId: "n-3" },
  { type: "ApplyEnhancement", actionId: "a5", deckIndex: 4, enhancementId: "bloodboil" },
  { type: "RestChoice", actionId: "a6", optionId: "heal" },
  { type: "DebugCommand", actionId: "a7", command: "set hp 1" },
  { type: "Noop", actionId: "a8" },
];

describe("core/actions 可序列化（2.2）", () => {
  it("全部 Action 可无损 JSON 往返", () => {
    for (const action of ALL_ACTIONS) {
      expect(isRoundTrippable(action), action.type).toBe(true);
    }
  });
});

describe("core/events 事件构造（2.2）", () => {
  it("seq 全局递增、actionId 归组", () => {
    const sink = new EventSink(10, "a-endturn");
    sink.emit("TurnEnded", { turn: 1 });
    sink.emit("TurnStarted", { turn: 2 });
    sink.emit("CardsDrawn", { cardIds: ["c1", "c2"] });

    const events = sink.list();
    expect(events.map((e) => e.seq)).toEqual([10, 11, 12]);
    expect(new Set(events.map((e) => e.actionId))).toEqual(new Set(["a-endturn"]));
    expect(sink.nextSeq).toBe(13);
    expect(sink.length).toBe(3);
  });

  it("DamageDealt 载荷携带修饰层明细", () => {
    const sink = new EventSink(0, "a1");
    sink.emit("DamageDealt", {
      sourceId: "player",
      targetId: "enemy-1",
      base: 6,
      layers: [{ sourceId: "strength", layer: "buff", op: "add", value: 2, before: 6, after: 8 }],
      value: 8,
      blocked: 0,
      hpLost: 8,
      segment: 1,
      segments: 1,
    });
    const [event] = sink.list();
    expect(event.type).toBe("DamageDealt");
    if (event.type === "DamageDealt") {
      expect(event.layers[0].sourceId).toBe("strength");
      expect(event.value).toBe(8);
    }
  });
});
