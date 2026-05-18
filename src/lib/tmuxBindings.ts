import { createSignal } from "solid-js";

const STORAGE_KEY = "dwarf-claws-tmux-bindings";

function readAll(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

const [bindings, setBindings] = createSignal<Record<string, string>>(readAll());

function writeAll(map: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode errors
  }
}

export function tmuxBindings(): Record<string, string> {
  return bindings();
}

export function tmuxBindingFor(sessionId: string): string | null {
  return bindings()[sessionId] ?? null;
}

export function setTmuxBinding(sessionId: string, pane: string | null): void {
  const next = { ...bindings() };
  if (!pane) {
    if (!(sessionId in next)) return;
    delete next[sessionId];
  } else {
    next[sessionId] = pane;
  }
  setBindings(next);
  writeAll(next);
}
