import { test, expect } from "bun:test"
import { isEmptyCompletion } from "../../src/session/empty-completion"

test("empty completion is stop + 0 output + 0 reasoning", () => {
  expect(isEmptyCompletion({ result: "stop", tokens: { output: 0, reasoning: 0 } })).toBe(true)
  expect(isEmptyCompletion({ result: "stop", finish: "unknown", tokens: { output: 0, reasoning: 0 } })).toBe(true)
})

test("empty completion is not a successful or in-flight turn", () => {
  expect(isEmptyCompletion({ result: "stop", tokens: { output: 1, reasoning: 0 } })).toBe(false)
  expect(isEmptyCompletion({ result: "stop", tokens: { output: 0, reasoning: 12 } })).toBe(false)
  expect(isEmptyCompletion({ result: "continue", tokens: { output: 0, reasoning: 0 } })).toBe(false)
  expect(
    isEmptyCompletion({ result: "stop", error: { name: "UnknownError" }, tokens: { output: 0, reasoning: 0 } }),
  ).toBe(false)
})
