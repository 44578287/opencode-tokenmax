import { describe, expect, test } from "bun:test"
import { isEmptyCompletion } from "../../src/session/empty-completion"
import { isFakeContinue, isPersistableUserPart, shouldDispatchFirstTurn } from "../../src/session/user-parts"

const FIRST = "只回复 OK"
const SHORTS = ["hi", "ok", "谢谢", "只回复 1", "ping", "好", "继续", "yes", "no", "嗯"]

describe("first-turn regression (required)", () => {
  test("FIRST TURN 20x: short first prompt never dispatches subtasks", () => {
    for (let i = 0; i < 20; i++) {
      expect(shouldDispatchFirstTurn(FIRST, "")).toBe(false)
      expect(shouldDispatchFirstTurn(FIRST)).toBe(false)
    }
  })

  test("SHORT PROMPT 20x: tiny first-turn texts never dispatch", () => {
    for (let i = 0; i < 20; i++) {
      const text = SHORTS[i % SHORTS.length]
      expect(shouldDispatchFirstTurn(text, "")).toBe(false)
    }
  })

  test("invalid plugin subtask parts are not persistable", () => {
    expect(
      isPersistableUserPart({
        type: "subtask",
        prompt: "search",
        description: "tokenmax-search",
        agent: "tokenmax-search",
      }),
    ).toBe(false)
    expect(
      isPersistableUserPart({
        type: "subtask",
        id: "prt_ok",
        sessionID: "ses_ok",
        messageID: "msg_ok",
        agent: "tokenmax-search",
      }),
    ).toBe(true)
  })

  test("user text parts stay persistable when a bad subtask is mixed in", () => {
    const parts = [
      { type: "text", id: "prt_1", sessionID: "ses_1", messageID: "msg_1", text: FIRST },
      { type: "subtask", prompt: "x", agent: "tokenmax-search" },
    ]
    const kept = parts.filter((part) => isPersistableUserPart(part))
    expect(kept).toHaveLength(1)
    expect(kept[0]?.type).toBe("text")
    expect((kept[0] as { text: string }).text).toBe(FIRST)
  })

  test("never inject fake continue", () => {
    expect(isFakeContinue("Continue the current task. Do not ask the user to switch models.")).toBe(true)
    expect(isFakeContinue(FIRST)).toBe(false)
    expect(isFakeContinue("继续")).toBe(false)
  })

  test("empty completion is not a silent success", () => {
    expect(isEmptyCompletion({ result: "stop", tokens: { output: 0, reasoning: 0 } })).toBe(true)
    expect(isEmptyCompletion({ result: "stop", tokens: { output: 2, reasoning: 0 } })).toBe(false)
  })

  test("coding prompt may dispatch; first-turn OK must not", () => {
    expect(shouldDispatchFirstTurn("Read src/index.ts and explain the exported API", "")).toBe(true)
    expect(shouldDispatchFirstTurn(FIRST, "")).toBe(false)
  })
})
