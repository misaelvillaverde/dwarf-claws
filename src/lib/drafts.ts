const PREFIX = "dwarf-claws-draft:";

export function getDraft(sessionId: string): string {
  try {
    return localStorage.getItem(PREFIX + sessionId) ?? "";
  } catch {
    return "";
  }
}

export function setDraft(sessionId: string, text: string): void {
  try {
    if (!text) localStorage.removeItem(PREFIX + sessionId);
    else localStorage.setItem(PREFIX + sessionId, text);
  } catch {
    // ignore quota / private mode errors
  }
}

export function clearDraft(sessionId: string): void {
  setDraft(sessionId, "");
}
