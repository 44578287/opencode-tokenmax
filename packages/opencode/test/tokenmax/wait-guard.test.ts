import { describe, expect, test } from "bun:test"
import { eventWaitViolation, observableOperationType } from "../../src/tokenmax/wait-guard"

describe("TokenMax anti-sleep guard", () => {
  test("blocks a guessed wait around a build or CI observation", () => {
    expect(eventWaitViolation("bun run build; Start-Sleep 300; Test-Path dist/app.exe")).toContain("USE_EVENT_WAIT")
    expect(eventWaitViolation("sleep 60; gh run view 123 --json status")).toContain("USE_EVENT_WAIT")
  })

  test("allows an intentional isolated debounce delay", () => {
    expect(eventWaitViolation("Start-Sleep 2")).toBeUndefined()
  })

  test("classifies build and GitHub operations for the Runtime, not the LLM", () => {
    expect(observableOperationType("bun run build")).toBe("PROCESS")
    expect(observableOperationType("gh run watch 32500407070 --exit-status")).toBe("GITHUB_ACTIONS")
  })
})
