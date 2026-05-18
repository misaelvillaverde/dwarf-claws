import { createSignal } from "solid-js";

const KEY = "dwarf-claws-names";

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

const [names, setNames] = createSignal<Record<string, string>>(load());

export function customNames() {
  return names();
}

export function customNameFor(id: string): string | undefined {
  const n = names()[id];
  return n && n.trim() ? n : undefined;
}

export function setCustomName(id: string, name: string | null) {
  const next = { ...names() };
  if (name && name.trim()) {
    next[id] = name.trim();
  } else {
    delete next[id];
  }
  setNames(next);
  localStorage.setItem(KEY, JSON.stringify(next));
}
