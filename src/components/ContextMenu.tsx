import { Component, For, Show, createEffect, onCleanup } from "solid-js";

export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  danger?: boolean;
  run: () => void;
}

interface Props {
  open: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

const ContextMenu: Component<Props> = (props) => {
  const handleKey = (e: KeyboardEvent) => {
    if (!props.open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
  };

  createEffect(() => {
    if (props.open) {
      window.addEventListener("keydown", handleKey, true);
    }
    onCleanup(() => window.removeEventListener("keydown", handleKey, true));
  });

  const clampedPos = () => {
    if (typeof window === "undefined") return { x: props.x, y: props.y };
    const menuW = 220;
    const menuH = Math.min(280, 28 * props.items.length + 8);
    const x = Math.min(props.x, window.innerWidth - menuW - 8);
    const y = Math.min(props.y, window.innerHeight - menuH - 8);
    return { x: Math.max(8, x), y: Math.max(8, y) };
  };

  return (
    <Show when={props.open}>
      <div
        onClick={props.onClose}
        onContextMenu={(e) => { e.preventDefault(); props.onClose(); }}
        style={{
          position: "fixed",
          inset: 0,
          "z-index": 1500,
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          class="frame"
          style={{
            position: "absolute",
            left: `${clampedPos().x}px`,
            top: `${clampedPos().y}px`,
            width: "220px",
            "box-shadow": "0 4px 16px rgba(0,0,0,0.3)",
            padding: "2px 0",
          }}
        >
          <For each={props.items}>
            {(item) => (
              <div
                onClick={() => {
                  item.run();
                  props.onClose();
                }}
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                  padding: "5px 10px",
                  "font-size": "12px",
                  cursor: "pointer",
                  color: item.danger ? "var(--warn)" : "var(--ink)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "var(--paper-3)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "";
                }}
              >
                <span style={{ flex: 1 }}>{item.label}</span>
                <Show when={item.hint}>
                  <span class="ink-faint" style={{ "font-size": "10.5px" }}>{item.hint}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
};

export default ContextMenu;
