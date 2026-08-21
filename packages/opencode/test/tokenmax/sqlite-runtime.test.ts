import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

describe("tokenmax sqlite runtime", () => {
  test("core sources do not import bun:sqlite", () => {
    const dir = path.join(import.meta.dir, "../../src/tokenmax")
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))
    for (const file of files) {
      const text = fs.readFileSync(path.join(dir, file), "utf8")
      expect(text.includes("bun:sqlite")).toBe(false)
    }
  })
})
