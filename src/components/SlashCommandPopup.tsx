import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { listSlashCommands, type SlashCommand } from "../lib/api";

interface Props {
  cwd: string | null;
  query: string | null; // null = closed; "" or string after `/` when open
  onSelect: (name: string) => void;
  onClose: () => void;
  registerKeyHandler?: (h: ((e: KeyboardEvent) => boolean) | null) => void;
}

const cache: { cwd: string | null; ts: number; items: SlashCommand[] } = {
  cwd: null,
  ts: 0,
  items: [],
};
const CACHE_TTL = 5000;

async function loadCommands(cwd: string | null): Promise<SlashCommand[]> {
  const now = Date.now();
  if (cache.cwd === cwd && now - cache.ts < CACHE_TTL) {
    return cache.items;
  }
  try {
    const items = await listSlashCommands(cwd);
    cache.cwd = cwd;
    cache.ts = now;
    cache.items = items;
    return items;
  } catch (e) {
    console.warn("listSlashCommands failed", e);
    return cache.items;
  }
}

function kindGlyph(kind: SlashCommand["kind"]): string {
  if (kind === "skill") return "S";
  if (kind === "agent") return "A";
  return "C";
}

type SlashCommandIndexed = SlashCommand & { _lower: string };

const SlashCommandPopup: Component<Props> = (props) => {
  const [items, setItems] = createSignal<SlashCommandIndexed[]>([]);
  const [focused, setFocused] = createSignal(0);

  // Load commands only when cwd changes or when the popup opens (query null -> non-null).
  // While typing, we don't re-run loadCommands; the items list is stable.
  createEffect((prevOpen: boolean) => {
    const open = props.query !== null;
    const cwd = props.cwd;
    if (open && !prevOpen) {
      void loadCommands(cwd).then((list) =>
        setItems(list.map((c) => ({
          ...c,
          _lower: (c.name + " " + (c.description ?? "")).toLowerCase(),
        })))
      );
    }
    return open;
  }, false);

  createEffect((prevCwd: string | null | undefined) => {
    const cwd = props.cwd;
    if (cwd !== prevCwd && props.query !== null) {
      void loadCommands(cwd).then((list) =>
        setItems(list.map((c) => ({
          ...c,
          _lower: (c.name + " " + (c.description ?? "")).toLowerCase(),
        })))
      );
    }
    return cwd;
  }, undefined);

  const filtered = createMemo(() => {
    const q = (props.query ?? "").trim().toLowerCase();
    const list = items();
    if (!q) return list.slice(0, 50);
    return list.filter((c) => c._lower.includes(q)).slice(0, 50);
  });

  createEffect(() => {
    // Reset focus when filtered list changes.
    const len = filtered().length;
    if (focused() >= len) setFocused(0);
  });

  const handleKey = (e: KeyboardEvent): boolean => {
    if (props.query === null) return false;
    const list = filtered();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocused((i) => Math.min(list.length - 1, i + 1));
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocused((i) => Math.max(0, i - 1));
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      if (list.length === 0) return false;
      e.preventDefault();
      const pick = list[focused()] ?? list[0];
      props.onSelect(pick.name);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
      return true;
    }
    return false;
  };

  createEffect(() => {
    if (props.registerKeyHandler) {
      props.registerKeyHandler(props.query !== null ? handleKey : null);
    }
  });

  onCleanup(() => {
    props.registerKeyHandler?.(null);
  });

  return (
    <Show when={props.query !== null}>
      <div
        class="dc-slash-popup"
        style={{
          position: "absolute",
          bottom: "100%",
          left: 0,
          right: 0,
          "max-height": "260px",
          overflow: "auto",
          background: "var(--paper-2, var(--surface, white))",
          border: "1px solid var(--rule, var(--m-border))",
          "border-bottom": "none",
          "border-radius": "6px 6px 0 0",
          "box-shadow": "0 -4px 12px rgba(0,0,0,0.08)",
          "z-index": 20,
          "font-size": "12px",
        }}
      >
        <Show
          when={filtered().length > 0}
          fallback={
            <div class="ink-faint" style={{
              padding: "10px 12px",
              "font-style": "italic",
              "text-align": "center",
            }}>
              no slash commands match
            </div>
          }
        >
          <div style={{
            padding: "4px 10px",
            "border-bottom": "1px solid var(--rule-soft, var(--border-soft))",
            "font-size": "10.5px",
            color: "var(--ink-3, var(--text-3))",
            "letter-spacing": "0.05em",
            "text-transform": "uppercase",
            display: "flex",
            "align-items": "center",
            gap: "8px",
          }}>
            <span>Slash commands</span>
            <span style={{ "margin-left": "auto" }}>{filtered().length}</span>
            <span class="ink-faint" style={{ "text-transform": "none", "letter-spacing": 0 }}>
              ↑↓ navigate · ⏎/⇥ insert · esc close
            </span>
          </div>
          <For each={filtered()}>
            {(c, i) => (
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  props.onSelect(c.name);
                }}
                onMouseEnter={() => setFocused(i())}
                style={{
                  padding: "6px 10px",
                  cursor: "pointer",
                  display: "flex",
                  "align-items": "baseline",
                  gap: "8px",
                  background: focused() === i() ? "var(--accent-soft, var(--surface-3, rgba(0,0,0,0.04)))" : undefined,
                  "border-left": focused() === i()
                    ? "2px solid var(--accent, var(--m-accent))"
                    : "2px solid transparent",
                }}
              >
                <span style={{
                  display: "inline-block",
                  width: "14px",
                  "text-align": "center",
                  "font-weight": 700,
                  "font-size": "10px",
                  color: c.kind === "skill"
                    ? "var(--ok, var(--m-ok))"
                    : c.kind === "agent"
                      ? "var(--info, var(--m-info, var(--m-accent)))"
                      : "var(--ink-3, var(--text-3))",
                  "border": "1px solid currentColor",
                  "border-radius": "2px",
                  "line-height": "12px",
                }}>{kindGlyph(c.kind)}</span>
                <span style={{
                  color: "var(--ink, var(--m-text))",
                  "font-weight": 600,
                  "white-space": "nowrap",
                }}>/{c.name}</span>
                <span class="ink-faint" style={{
                  "font-size": "10.5px",
                  "white-space": "nowrap",
                }}>{c.scope}</span>
                <Show when={c.description}>
                  <span class="ink-mid" style={{
                    "font-size": "11px",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                    flex: 1,
                    "min-width": 0,
                  }}>
                    {c.description}
                  </span>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </Show>
  );
};

export default SlashCommandPopup;
