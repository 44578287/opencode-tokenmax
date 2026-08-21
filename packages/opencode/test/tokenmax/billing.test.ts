import { describe, expect, test } from "bun:test"
import { AUTH_MODE, BILLING_TYPE, classifyCost, isMonetaryFree } from "../../src/tokenmax/billing"

describe("tokenmax billing", () => {
  test("FREE only when catalog cost is 0/0", () => {
    const free = classifyCost({ providerId: "opencode", cost: { input: 0, output: 0 }, authMode: AUTH_MODE.NONE })
    expect(free.billingType).toBe(BILLING_TYPE.FREE)
    expect(isMonetaryFree({ input: 0, output: 0 })).toBe(true)
    expect(isMonetaryFree({ input: 0, output: 1 })).toBe(false)
    expect(isMonetaryFree(null)).toBe(false)
  })

  test("opencode provider is not free without zero price", () => {
    const unknown = classifyCost({ providerId: "opencode", cost: null, authMode: AUTH_MODE.NONE })
    expect(unknown.billingType).toBe(BILLING_TYPE.UNKNOWN)
  })

  test("anthropic oauth is SUBSCRIPTION_QUOTA", () => {
    const sub = classifyCost({ providerId: "anthropic", cost: { input: 3, output: 15 }, authMode: AUTH_MODE.OAUTH })
    expect(sub.billingType).toBe(BILLING_TYPE.SUBSCRIPTION_QUOTA)
    expect(sub.quotaBased).toBe(true)
  })

  test("anthropic api-key is PAYG_TOKEN", () => {
    const payg = classifyCost({ providerId: "anthropic", cost: { input: 3, output: 15 }, authMode: AUTH_MODE.API_KEY })
    expect(payg.billingType).toBe(BILLING_TYPE.PAYG_TOKEN)
  })

  test("LOCAL from localhost baseURL", () => {
    const local = classifyCost({
      providerId: "custom",
      cost: { input: 0, output: 0 },
      cfg: { provider: { custom: { baseURL: "http://127.0.0.1:1234/v1" } } },
    })
    expect(local.billingType).toBe(BILLING_TYPE.LOCAL)
  })
})
