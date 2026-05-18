import { Component, Show, createSignal, createEffect } from "solid-js";

interface Props {
  open: boolean;
  initial: string;
  title: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

const RenameDialog: Component<Props> = (props) => {
  const [value, setValue] = createSignal("");
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (props.open) {
      setValue(props.initial);
      queueMicrotask(() => {
        inputRef?.focus();
        inputRef?.select();
      });
    }
  });

  const save = () => {
    props.onSave(value());
    props.onClose();
  };

  return (
    <Show when={props.open}>
      <div
        onClick={props.onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          "z-index": 1400,
          display: "flex",
          "align-items": "flex-start",
          "justify-content": "center",
          "padding-top": "20vh",
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          class="frame"
          style={{
            width: "min(440px, 92vw)",
            "box-shadow": "0 8px 32px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{
            padding: "6px 10px",
            "border-bottom": "1px solid var(--rule)",
            "font-size": "11px",
            color: "var(--ink-2)",
            "letter-spacing": "0.06em",
            "text-transform": "uppercase",
          }}>
            ┄ rename session
          </div>
          <div style={{ padding: "10px" }}>
            <div class="ink-faint" style={{
              "font-size": "10.5px",
              "margin-bottom": "4px",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
            }}>
              {props.title}
            </div>
            <input
              ref={inputRef}
              type="text"
              value={value()}
              onInput={(e) => setValue(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); save(); }
                if (e.key === "Escape") { e.preventDefault(); props.onClose(); }
              }}
              placeholder="custom name (empty to clear)"
              style={{ width: "100%", height: "28px", "font-size": "13px" }}
            />
            <div style={{
              display: "flex",
              gap: "6px",
              "justify-content": "flex-end",
              "margin-top": "10px",
            }}>
              <button onClick={props.onClose}>Cancel</button>
              <button class="active" onClick={save}>Save</button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default RenameDialog;
