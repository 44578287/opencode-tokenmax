import { describe, expect, test } from "bun:test"
import { TokenMaxRequirements } from "@/tokenmax/requirements"

const { derive } = TokenMaxRequirements

describe("derive", () => {
  test("an agent with tools enabled requires a tool-capable model", () => {
    expect(derive({ hasEnabledTools: true }).requireToolCall).toBe(true)
  })

  test("a tool-less agent does NOT require a tool-capable model (can use a cheaper non-tool model)", () => {
    expect(derive({ hasEnabledTools: false }).requireToolCall).toBe(false)
  })

  test("a pinned temperature requires a temperature-capable model", () => {
    expect(derive({ hasEnabledTools: true, temperature: 0.5 }).requireTemperature).toBe(true)
    // temperature 0 is still a real, pinned value -- not the same as unset.
    expect(derive({ hasEnabledTools: true, temperature: 0 }).requireTemperature).toBe(true)
  })

  test("no pinned temperature does not require temperature support", () => {
    expect(derive({ hasEnabledTools: true }).requireTemperature).toBe(false)
    expect(derive({ hasEnabledTools: true, temperature: undefined }).requireTemperature).toBe(false)
  })

  test("reasoning is never required here -- it's not a reliably derivable agent signal", () => {
    // Structural: the Requirements shape has no requireReasoning field at all,
    // so this derivation can never over-constrain on reasoning.
    expect("requireReasoning" in derive({ hasEnabledTools: true })).toBe(false)
  })
})
