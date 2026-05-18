import { Component, For, Show, createSignal, createMemo, createEffect, onCleanup } from "solid-js";

export interface Command {
  id: string;
  title: string;
  hint?: string;
  group?: string;
  /** Either run or children must be set. */
  run?: () => void | Promise<void>;
  /** When set, selecting this command opens a sub-menu. */
  children?: Command[];
  /** Optional prompt mode (for free-text input). */
  prompt?: {
    placeholder: string;
    apply: (value: string) => void;
  };
}

interface Props {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}

const CommandPalette: Component<Props> = (props) => {
  const [query, setQuery] = createSignal("");
  const [focused, setFocused] = createSignal(0);
  const [stack, setStack] = createSignal<Command[]>([]);
  const [promptCmd, setPromptCmd] = createSignal<Command | null>(null);
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (props.open) {
      setQuery("");
      setFocused(0);
      setStack([]);
      setPromptCmd(null);
      queueMicrotask(() => inputRef?.focus());
    }
  });

  const currentList = (): Command[] => {
    const s = stack();
    if (s.length === 0) return props.commands;
    return s[s.length - 1].children ?? [];
  };

  const filtered = createMemo(() => {
    const q = query().toLowerCase().trim();
    if (!q || promptCmd()) return currentList();
    return currentList().filter(c => {
      const hay = (c.title + " " + (c.hint ?? "") + " " + (c.group ?? "")).toLowerCase();
      return hay.includes(q);
    });
  });

  createEffect(() => {
    const list = filtered();
    if (focused() >= list.length) setFocused(Math.max(0, list.length - 1));
  });

  const runCommand = async (cmd: Command) => {
    if (cmd.children && cmd.children.length > 0) {
      setStack([...stack(), cmd]);
      setQuery("");
      setFocused(0);
      queueMicrotask(() => inputRef?.focus());
      return;
    }
    if (cmd.prompt) {
      setPromptCmd(cmd);
      setQuery("");
      queueMicrotask(() => inputRef?.focus());
      return;
    }
    await cmd.run?.();
    props.onClose();
  };

  const popStack = () => {
    setStack(stack().slice(0, -1));
    setQuery("");
    setFocused(0);
  };

  const handleKey = (e: KeyboardEvent) => {
    if (!props.open) return;

    if (e.key === "Escape") {
      e.preventDefault();
      if (promptCmd()) {
        setPromptCmd(null);
        setQuery("");
      } else if (stack().length > 0) {
        popStack();
      } else {
        props.onClose();
      }
      return;
    }

    if (promptCmd()) {
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = promptCmd()!;
        const value = query().trim();
        if (value && cmd.prompt) cmd.prompt.apply(value);
        props.onClose();
      }
      return;
    }

    if (e.key === "Backspace" && query() === "" && stack().length > 0) {
      e.preventDefault();
      popStack();
      return;
    }

    const list = filtered();
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setFocused(i => Math.min(list.length - 1, i + 1));
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setFocused(i => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = list[focused()];
      if (cmd) runCommand(cmd);
    }
  };

  createEffect(() => {
    if (props.open) {
      window.addEventListener("keydown", handleKey, true);
    }
    onCleanup(() => window.removeEventListener("keydown", handleKey, true));
  });

  const breadcrumbs = () => stack().map(c => c.title);

  return (
    <Show when={props.open}>
      <div
        onClick={props.onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          "z-index": 1000,
          display: "flex",
          "align-items": "flex-start",
          "justify-content": "center",
          "padding-top": "12vh",
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          class="frame"
          style={{
            width: "min(560px, 92vw)",
            "max-height": "60vh",
            "box-shadow": "0 8px 32px rgba(0,0,0,0.4)",
            display: "flex",
            "flex-direction": "column",
          }}
        >
          <Show when={breadcrumbs().length > 0 || promptCmd()}>
            <div style={{
              padding: "6px 12px",
              "border-bottom": "1px dashed var(--rule-soft, var(--border-soft))",
              "font-size": "11px",
              color: "var(--ink-2, var(--text-2))",
              "letter-spacing": "0.06em",
              "text-transform": "uppercase",
              display: "flex",
              gap: "6px",
              "align-items": "center",
            }}>
              <span class="ink-faint">┄</span>
              <For each={breadcrumbs()}>
                {(b, i) => (
                  <>
                    <Show when={i() > 0}><span class="ink-faint">›</span></Show>
                    <span>{b}</span>
                  </>
                )}
              </For>
              <Show when={promptCmd()}>
                <span class="ink-faint">›</span>
                <span>{promptCmd()!.title}</span>
              </Show>
            </div>
          </Show>

          <div style={{
            padding: "8px 10px",
            "border-bottom": "1px solid var(--rule, var(--border))",
          }}>
            <input
              ref={inputRef}
              type="text"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder={
                promptCmd()
                  ? promptCmd()!.prompt!.placeholder
                  : stack().length > 0
                  ? `search in ${stack()[stack().length - 1].title.toLowerCase()}…`
                  : "type a command…"
              }
              style={{
                width: "100%",
                height: "28px",
                "font-size": "13px",
              }}
            />
          </div>

          <div style={{ flex: 1, overflow: "auto" }}>
            <Show when={!promptCmd()}>
              <Show
                when={filtered().length > 0}
                fallback={
                  <div class="ink-faint" style={{
                    padding: "16px",
                    "text-align": "center",
                    "font-style": "italic",
                    "font-size": "11.5px",
                  }}>
                    no matching commands
                  </div>
                }
              >
                <For each={filtered()}>
                  {(cmd, i) => {
                    const isFocused = () => i() === focused();
                    const hasChildren = !!(cmd.children && cmd.children.length > 0);
                    return (
                      <div
                        class={`row ${isFocused() ? "focused" : ""}`}
                        onMouseEnter={() => setFocused(i())}
                        onClick={() => runCommand(cmd)}
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "10px",
                          padding: "6px 12px",
                          "border-bottom": "1px solid var(--rule-soft, var(--border-soft))",
                          "border-left": isFocused() ? "2px solid var(--accent, var(--m-accent))" : "2px solid transparent",
                          "font-size": "12px",
                        }}
                      >
                        <Show when={cmd.group}>
                          <span class="ink-faint" style={{
                            "font-size": "10px",
                            "letter-spacing": "0.08em",
                            "text-transform": "uppercase",
                            "min-width": "50px",
                          }}>
                            {cmd.group}
                          </span>
                        </Show>
                        <span style={{
                          flex: 1,
                          color: "var(--ink, var(--m-text))",
                          overflow: "hidden",
                          "text-overflow": "ellipsis",
                          "white-space": "nowrap",
                        }}>
                          {cmd.title}{hasChildren ? " …" : ""}
                        </span>
                        <Show when={hasChildren}>
                          <span class="ink-faint" style={{ "font-size": "11px" }}>›</span>
                        </Show>
                        <Show when={cmd.hint}>
                          <span class="ink-faint" style={{ "font-size": "11px" }}>{cmd.hint}</span>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </Show>

            <Show when={promptCmd()}>
              <div class="ink-faint" style={{
                padding: "12px",
                "font-size": "11.5px",
                "line-height": 1.5,
              }}>
                Type your value, then press <kbd style={kbdStyle}>Enter</kbd> to apply (<kbd style={kbdStyle}>Esc</kbd> cancels).
              </div>
            </Show>
          </div>

          <div style={{
            display: "flex",
            gap: "12px",
            padding: "4px 10px",
            "border-top": "1px solid var(--rule, var(--border))",
            "font-size": "10.5px",
            color: "var(--ink-3, var(--text-3))",
            background: "var(--paper-2, var(--surface-2))",
          }}>
            <span><kbd style={kbdStyle}>↑↓</kbd> nav</span>
            <span><kbd style={kbdStyle}>↵</kbd> {currentList().length > 0 && filtered()[focused()]?.children ? "open" : "run"}</span>
            <Show when={stack().length > 0}>
              <span><kbd style={kbdStyle}>⌫</kbd> back</span>
            </Show>
            <span><kbd style={kbdStyle}>esc</kbd> close</span>
            <span style={{ "margin-left": "auto" }}>
              {filtered().length} {promptCmd() ? "" : "match"}{filtered().length === 1 || promptCmd() ? "" : "es"}
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
};

const kbdStyle = {
  background: "var(--paper-3, var(--surface-3))",
  border: "1px solid var(--rule, var(--border))",
  padding: "0 4px",
  "font-size": "10px",
  color: "var(--ink-2, var(--text-2))",
  "font-family": "inherit",
  height: "14px",
  display: "inline-flex",
  "align-items": "center",
  "line-height": 1,
};

export default CommandPalette;
