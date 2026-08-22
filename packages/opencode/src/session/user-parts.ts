export function isPersistableUserPart(part: {
  id?: string
  sessionID?: string
  messageID?: string
  type?: string
  [key: string]: unknown
}) {
  if (!part || typeof part !== "object") return false
  if (part.type === "subtask") {
    return Boolean(part.id && part.sessionID && part.messageID && part.id.startsWith("prt"))
  }
  return true
}

export function shouldDispatchFirstTurn(messageText: string, conversationContext = "") {
  const t = String(messageText || "").trim()
  if (!t) return false
  if (t.startsWith("/")) return false
  if (t.length < 24 && String(conversationContext || "").trim().length < 40) return false
  return true
}

export function isFakeContinue(text: string) {
  return /Continue the current task\. Do not ask the user to switch models\./.test(String(text || ""))
}
