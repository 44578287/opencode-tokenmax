import { describe, expect, test } from "bun:test"
import { TokenMaxAvailability } from "@/tokenmax/availability"

const { isCallable, fromConnected } = TokenMaxAvailability

describe("fromConnected", () => {
  test("a connected provider is provider_listed", () => {
    expect(fromConnected(true)).toBe("provider_listed")
  })

  test("a not-connected provider is catalog_only", () => {
    expect(fromConnected(false)).toBe("catalog_only")
  })
})

describe("isCallable", () => {
  test("provider_listed and verified_callable are callable", () => {
    expect(isCallable("provider_listed")).toBe(true)
    expect(isCallable("verified_callable")).toBe(true)
  })

  test("catalog_only is NOT callable -- it's a suggestion, not a usable resource", () => {
    expect(isCallable("catalog_only")).toBe(false)
  })

  test("every failure/unknown state is non-callable", () => {
    for (const state of ["throttled", "temp_unavailable", "auth_invalid", "model_not_found", "stale", "unknown"] as const) {
      expect(isCallable(state)).toBe(false)
    }
  })
})
