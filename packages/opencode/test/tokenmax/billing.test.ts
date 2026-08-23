import { expect, test } from "bun:test"
import { TokenMaxBilling } from "@/tokenmax/billing"

test("classify: zero cost on both input and output is free", () => {
  expect(TokenMaxBilling.classify({ input: 0, output: 0 })).toBe("free")
})

test("classify: zero input with nonzero output is not free", () => {
  expect(TokenMaxBilling.classify({ input: 0, output: 0.000002 })).not.toBe("free")
})

test("classify: at or below the economy threshold is economy", () => {
  const thresholds = { economyMaxPerMTok: 1, standardMaxPerMTok: 8 }
  // blended $/1M = (input + output) / 2 * 1e6
  expect(TokenMaxBilling.classify({ input: 0.0000005, output: 0.0000005 }, thresholds)).toBe("economy")
  expect(TokenMaxBilling.classify({ input: 0.000001, output: 0.000001 }, thresholds)).toBe("economy")
})

test("classify: above economy but at or below standard threshold is standard", () => {
  const thresholds = { economyMaxPerMTok: 1, standardMaxPerMTok: 8 }
  expect(TokenMaxBilling.classify({ input: 0.000004, output: 0.000004 }, thresholds)).toBe("standard")
  expect(TokenMaxBilling.classify({ input: 0.000008, output: 0.000008 }, thresholds)).toBe("standard")
})

test("classify: above standard threshold is premium", () => {
  const thresholds = { economyMaxPerMTok: 1, standardMaxPerMTok: 8 }
  expect(TokenMaxBilling.classify({ input: 0.00003, output: 0.00003 }, thresholds)).toBe("premium")
})

test("classify: uses the default thresholds when none are given", () => {
  // Above defaultThresholds.standardMaxPerMTok (8) -> premium regardless of
  // caller-supplied thresholds.
  expect(TokenMaxBilling.classify({ input: 0.00003, output: 0.00003 })).toBe("premium")
})

test("blendedPerMTok: averages input and output, scaled to per-million-token dollars", () => {
  expect(TokenMaxBilling.blendedPerMTok({ input: 0.000001, output: 0.000003 })).toBeCloseTo(2, 10)
})

test("classify: asymmetric cost (cheap input, expensive output) still classifies on the blend", () => {
  const thresholds = { economyMaxPerMTok: 1, standardMaxPerMTok: 8 }
  // blended = (0 + 0.00002) / 2 * 1e6 = 10 -> premium
  expect(TokenMaxBilling.classify({ input: 0, output: 0.00002 }, thresholds)).toBe("premium")
})
