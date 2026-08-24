import { describe, expect, test } from "bun:test"
import { TokenMaxReliability } from "@/tokenmax/reliability"

const { score, isUnreliable } = TokenMaxReliability

describe("score", () => {
  test("no history scores as fully trusted (cold start)", () => {
    expect(score([])).toEqual({ successRate: 1, sampleSize: 0 })
  })

  test("all successes scores 1.0", () => {
    expect(score([{ outcome: "success" }, { outcome: "success" }])).toEqual({ successRate: 1, sampleSize: 2 })
  })

  test("all failures scores 0", () => {
    expect(score([{ outcome: "error" }, { outcome: "error" }])).toEqual({ successRate: 0, sampleSize: 2 })
  })

  test("mixed outcomes compute the actual success rate", () => {
    expect(
      score([{ outcome: "success" }, { outcome: "success" }, { outcome: "error" }, { outcome: "success" }]),
    ).toEqual({ successRate: 0.75, sampleSize: 4 })
  })
})

describe("isUnreliable", () => {
  test("a resource with zero history is never unreliable, however the thresholds are set", () => {
    expect(isUnreliable(score([]))).toBe(false)
    expect(isUnreliable(score([]), { minSampleSize: 1 })).toBe(false)
  })

  test("a single failure is not enough signal by default (min sample size 3)", () => {
    expect(isUnreliable(score([{ outcome: "error" }]))).toBe(false)
  })

  test("3+ samples with a success rate at or below 50% is unreliable by default", () => {
    expect(isUnreliable(score([{ outcome: "error" }, { outcome: "error" }, { outcome: "success" }]))).toBe(true)
  })

  test("3+ samples with a success rate above 50% is not unreliable", () => {
    expect(
      isUnreliable(score([{ outcome: "success" }, { outcome: "success" }, { outcome: "error" }])),
    ).toBe(false)
  })

  test("thresholds are overridable", () => {
    const twoFailuresOneSuccess = score([{ outcome: "error" }, { outcome: "error" }, { outcome: "success" }])
    expect(isUnreliable(twoFailuresOneSuccess, { minSampleSize: 5 })).toBe(false) // not enough samples under a stricter minimum
    expect(isUnreliable(twoFailuresOneSuccess, { minSuccessRate: 0.9 })).toBe(true) // 33% is still below a lenient-sounding 90% bar
  })
})
