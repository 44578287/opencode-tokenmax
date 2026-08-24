import { describe, expect, test } from "bun:test"
import { TokenMaxPayment } from "@/tokenmax/payment"

const { classify } = TokenMaxPayment
const paid = { input: 0.00001, output: 0.00003 }
const freeCost = { input: 0, output: 0 }

describe("classify (connected)", () => {
  test("oauth credentials on a paid model => subscription_quota (already paid, no new cash)", () => {
    expect(classify({ cost: paid, connected: true, authType: "oauth" })).toBe("subscription_quota")
  })

  test("an api key on a paid model => payg_token (real cash per call)", () => {
    expect(classify({ cost: paid, connected: true, authType: "api" })).toBe("payg_token")
  })

  test("a wellknown token on a paid model => payg_token", () => {
    expect(classify({ cost: paid, connected: true, authType: "wellknown" })).toBe("payg_token")
  })

  test("a $0 model is free regardless of auth type", () => {
    expect(classify({ cost: freeCost, connected: true, authType: "api" })).toBe("free")
    expect(classify({ cost: freeCost, connected: true, authType: "oauth" })).toBe("free")
  })

  test("a local endpoint is local even with a nominal per-token cost", () => {
    for (const baseURL of [
      "http://localhost:11434/v1",
      "http://127.0.0.1:1234",
      "http://0.0.0.0:8080",
      "http://[::1]:5000",
    ]) {
      expect(classify({ cost: paid, connected: true, authType: "api", baseURL })).toBe("local")
    }
  })

  test("a remote baseURL is NOT treated as local", () => {
    expect(classify({ cost: paid, connected: true, authType: "api", baseURL: "https://api.example.com/v1" })).toBe(
      "payg_token",
    )
  })

  test("connected, paid, but no credential type to distinguish => unknown, never a guessed payg", () => {
    expect(classify({ cost: paid, connected: true })).toBe("unknown")
  })

  test("promotional_credit is never emitted -- there is no reliable signal for it yet", () => {
    // Exhaustively: no combination of the honest inputs produces it.
    const results = new Set<string>()
    for (const connected of [true, false]) {
      for (const cost of [paid, freeCost]) {
        for (const authType of [undefined, "oauth", "api", "wellknown"] as const) {
          for (const baseURL of [undefined, "http://localhost:1", "https://api.example.com"]) {
            results.add(classify({ cost, connected, authType, baseURL }))
          }
        }
      }
    }
    expect(results.has("promotional_credit")).toBe(false)
  })
})

describe("classify (catalog-only / not connected)", () => {
  test("a not-connected paid model is unknown -- we don't know how you'd pay for it", () => {
    expect(classify({ cost: paid, connected: false, authType: "api" })).toBe("unknown")
  })

  test("a not-connected $0 model is still free", () => {
    expect(classify({ cost: freeCost, connected: false })).toBe("free")
  })

  test("a garbage baseURL never throws -- it's just not local", () => {
    expect(classify({ cost: paid, connected: true, authType: "api", baseURL: "not a url" })).toBe("payg_token")
  })
})
