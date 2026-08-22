export function isEmptyCompletion(input: {
  error?: unknown
  finish?: string
  result?: string
  tokens?: { output?: number; reasoning?: number }
}) {
  if (input.error) return false
  if (input.result !== "stop") return false
  return (input.tokens?.output ?? 0) === 0 && (input.tokens?.reasoning ?? 0) === 0
}
