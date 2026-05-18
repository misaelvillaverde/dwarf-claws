import { Component, For, Show, createSignal, createEffect, onCleanup } from "solid-js";
import { sendToTmuxPane } from "../lib/api";
import type { UnifiedSession } from "../lib/types";
import SlashCommandPopup from "./SlashCommandPopup";
import { clearDraft, getDraft, setDraft } from "../lib/drafts";
import { detectXmlTags } from "../lib/markdown";

interface Props {
  session: UnifiedSession;
}

const Composer: Component<Props> = (props) => {
  const [sending, setSending] = createSignal(false);
  const [status, setStatus] = createSignal<string | null>(null);
  const [slashQuery, setSlashQuery] = createSignal<string | null>(null);
  const [xmlTags, setXmlTags] = createSignal<string[]>([]);
  let textareaRef: HTMLTextAreaElement | undefined;
  let popupKeyHandler: ((e: KeyboardEvent) => boolean) | null = null;
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;

  const computeSlashQuery = (v: string): string | null => {
    if (!v.startsWith("/")) return null;
    if (v.includes("\n")) return null;
    if (v.includes(" ")) return null; // closed once user typed a space (started args)
    return v.slice(1);
  };

  // Restore draft whenever the active session changes.
  createEffect(() => {
    const id = props.session.id;
    const draft = getDraft(id);
    if (textareaRef) {
      textareaRef.value = draft;
      // Resize to fit restored content.
      textareaRef.style.height = "auto";
      const h = Math.min(textareaRef.scrollHeight, 180);
      if (h > 0) textareaRef.style.height = h + "px";
    }
    setSlashQuery(computeSlashQuery(draft));
    setXmlTags(detectXmlTags(draft));
    setStatus(null);
  });

  onCleanup(() => {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
  });

  const scheduleDraftSave = (id: string, value: string) => {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => setDraft(id, value), 250);
  };

  const send = async () => {
    if (!textareaRef) return;
    const pane = props.session.tmux_pane;
    const body = textareaRef.value;
    if (!pane || !body.trim() || sending()) return;
    setSending(true);
    setStatus(null);
    try {
      await sendToTmuxPane(pane, body);
      textareaRef.value = "";
      textareaRef.style.height = "auto";
      setSlashQuery(null);
      setXmlTags([]);
      clearDraft(props.session.id);
      setStatus("sent");
      setTimeout(() => setStatus(null), 1500);
      textareaRef.focus();
    } catch (e) {
      console.error("sendToTmuxPane failed:", e);
      setStatus(`failed: ${String(e).slice(0, 80)}`);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (popupKeyHandler && popupKeyHandler(e)) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };

  const onInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    const v = e.currentTarget.value;
    setSlashQuery(computeSlashQuery(v));
    scheduleDraftSave(props.session.id, v);
    setXmlTags(detectXmlTags(v));
  };

  const onSlashSelect = (name: string) => {
    if (!textareaRef) return;
    const next = `/${name} `;
    textareaRef.value = next;
    setSlashQuery(null);
    scheduleDraftSave(props.session.id, next);
    queueMicrotask(() => {
      if (!textareaRef) return;
      textareaRef.focus();
      textareaRef.setSelectionRange(next.length, next.length);
    });
  };

  const hasPane = () => !!props.session.tmux_pane;

  return (
    <div style={{
      "border-top": "1px solid var(--rule)",
      background: "var(--paper-2)",
      padding: "8px 12px",
      "flex-shrink": 0,
      display: "flex",
      "flex-direction": "column",
      gap: "4px",
    }}>
      <div style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        "font-size": "10.5px",
        color: "var(--ink-3)",
        "letter-spacing": "0.06em",
        "text-transform": "uppercase",
      }}>
        <span>┄ send to tmux</span>
        <Show when={hasPane()} fallback={
          <span class="ink-faint" style={{ "text-transform": "none", "letter-spacing": 0, "font-style": "italic" }}>
            &middot; no tmux pane detected for cwd — open this session inside a tmux pane to enable
          </span>
        }>
          <code style={{ "font-size": "10.5px" }}>{props.session.tmux_pane}</code>
        </Show>
        <Show when={xmlTags().length > 0}>
          <span class="dc-xml-indicator" style={{ "text-transform": "none", "letter-spacing": 0 }}>
            <span class="dc-xml-label">tags</span>
            <For each={xmlTags()}>
              {(name) => <span class="dc-xml-tag">{`<${name}>`}</span>}
            </For>
          </span>
        </Show>
        <Show when={status()}>
          <span style={{
            "margin-left": "auto",
            color: status() === "sent" ? "var(--ok)" : "var(--warn)",
            "text-transform": "none",
            "letter-spacing": 0,
          }}>
            {status()}
          </span>
        </Show>
      </div>

      <div style={{ display: "flex", gap: "6px", "align-items": "flex-end", position: "relative" }}>
        <SlashCommandPopup
          cwd={props.session.cwd}
          query={slashQuery()}
          onSelect={onSlashSelect}
          onClose={() => setSlashQuery(null)}
          registerKeyHandler={(h) => { popupKeyHandler = h; }}
        />
        <textarea
          ref={textareaRef}
          onInput={onInput}
          onKeyDown={onKeyDown}
          disabled={!hasPane() || sending()}
          placeholder={
            hasPane()
              ? "type a message · ⌘↵ to send · / for commands"
              : "no tmux pane — sending disabled"
          }
          rows={3}
          style={{
            flex: 1,
            "min-height": "40px",
            "max-height": "180px",
            padding: "6px 8px",
            background: "var(--paper-3)",
            border: "1px solid var(--rule)",
            color: "var(--ink)",
            font: "inherit",
            "font-size": "12px",
            outline: "none",
            resize: "vertical",
          }}
        />
        <button
          onClick={send}
          disabled={!hasPane() || sending()}
          style={{
            height: "30px",
            opacity: !hasPane() || sending() ? 0.5 : 1,
          }}
        >
          {sending() ? "sending…" : "send ⌘↵"}
        </button>
      </div>
    </div>
  );
};

export default Composer;
