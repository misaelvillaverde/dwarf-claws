import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { UnifiedMessage, ContentBlock } from "../lib/types";
import type { ChatState } from "../lib/sessionState";
import MessageBlock from "./MessageBlock";

interface Props {
  messages: UnifiedMessage[];
  loading: boolean;
  sessionName: string | null;
  tailing?: boolean;
  chatState?: ChatState;
  onToggleTail?: () => void;
  pane?: string | null;
  pendingIds?: Set<string>;
  firstPendingId?: string | null;
}

const ConversationView: Component<Props> = (props) => {
  let scrollRef: HTMLDivElement | undefined;

  const toolResultsMap = createMemo(() => {
    const map = new Map<string, Extract<ContentBlock, { type: "tool_result" }>>();
    for (const msg of props.messages) {
      for (const block of msg.content) {
        if (block.type === "tool_result") {
          map.set(block.tool_id, block);
        }
      }
    }
    return map;
  });

  const getToolResult = (id: string) => toolResultsMap().get(id);

  const visibleMessages = createMemo(() =>
    props.messages.filter((m) => {
      const hasRenderable = m.content.some(
        (b) =>
          (b.type === "text" && b.text.trim().length > 0) ||
          (b.type === "thinking" && b.text.trim().length > 0) ||
          b.type === "tool_call",
      );
      return hasRenderable;
    }),
  );

  // Parent-owned tool_call expansion — survives virtualization unmount/remount.
  const [expandedTools, setExpandedTools] = createSignal<Set<string>>(new Set());
  const isToolExpanded = (id: string) => expandedTools().has(id);
  const toggleToolExpanded = (id: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Scroll policy:
  //  - new session loaded → jump to top (or bottom if entering with tailing on)
  //  - new messages arrive while tailing → stick to bottom
  //  - tailing turns ON → jump to bottom once
  //  - tailing turns OFF (idle) → leave scroll alone
  //  - otherwise → respect user's scroll position
  let lastFirstMsgId: string | null = null;
  let lastMsgCount = 0;
  let lastTailing = false;
  createEffect(() => {
    if (!scrollRef) return;
    const msgs = visibleMessages();
    const msgCount = msgs.length;
    const tailing = !!props.tailing;
    const firstMsgId = msgs[0]?.id ?? null;

    if (msgCount === 0) {
      lastFirstMsgId = firstMsgId;
      lastMsgCount = 0;
      lastTailing = tailing;
      return;
    }

    const newSession = firstMsgId !== lastFirstMsgId;
    const newMessages = !newSession && msgCount > lastMsgCount;
    const tailingTurnedOn = tailing && !lastTailing;

    if (newSession) {
      if (tailing && scrollRef) {
        queueMicrotask(() => {
          if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
        });
      } else if (scrollRef) {
        scrollRef.scrollTop = 0;
      }
      setExpandedTools(new Set<string>());
    } else if (tailing && (newMessages || tailingTurnedOn) && scrollRef) {
      queueMicrotask(() => {
        if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
      });
    }

    lastFirstMsgId = firstMsgId;
    lastMsgCount = msgCount;
    lastTailing = tailing;
  });

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        flex: 1,
        "min-height": 0,
        background: "var(--paper-2)",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "4px 12px",
          "border-bottom": "1px solid var(--rule-soft)",
          "font-size": "10.5px",
          color: "var(--ink-3)",
          "letter-spacing": "0.06em",
          "text-transform": "uppercase",
        }}
      >
        <span>┄ conversation</span>
        <Show when={props.tailing}>
          <span
            style={{
              display: "inline-flex",
              "align-items": "center",
              gap: "4px",
              color: "var(--ok)",
              "font-weight": 600,
            }}
          >
            <span class="live-dot"></span>
            live · tailing
          </span>
        </Show>
        <span class="ink-faint" style={{ "margin-left": "auto" }}>
          {visibleMessages().length} msgs &middot; scroll for history
        </span>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "12px 14px 60px",
        }}
      >
        <Show
          when={!props.loading}
          fallback={
            <div
              class="ink-faint"
              style={{ padding: "20px", "text-align": "center", "font-style": "italic" }}
            >
              loading…
            </div>
          }
        >
          <Show
            when={visibleMessages().length > 0}
            fallback={
              <div
                class="ink-faint"
                style={{ padding: "20px", "text-align": "center", "font-style": "italic" }}
              >
                ─ nothing yet ─
              </div>
            }
          >
            <For each={visibleMessages()}>
              {(msg) => (
                <Show
                  when={msg._optimistic}
                  fallback={
                    <MessageBlock
                      message={msg}
                      getToolResult={getToolResult}
                      pendingIds={props.pendingIds}
                      firstPendingId={props.firstPendingId ?? null}
                      pane={props.pane ?? null}
                      isToolExpanded={isToolExpanded}
                      onToggleToolExpanded={toggleToolExpanded}
                    />
                  }
                >
                  <div style={{ opacity: 0.55 }}>
                    <MessageBlock
                      message={msg}
                      getToolResult={getToolResult}
                      pendingIds={props.pendingIds}
                      firstPendingId={props.firstPendingId ?? null}
                      pane={props.pane ?? null}
                      isToolExpanded={isToolExpanded}
                      onToggleToolExpanded={toggleToolExpanded}
                    />
                    <div style={{
                      "font-size": "10px",
                      color: "var(--ink-3)",
                      "font-style": "italic",
                      padding: "0 0 6px 2px",
                    }}>
                      sending…
                    </div>
                  </div>
                </Show>
              )}
            </For>
            <Show when={props.tailing && props.chatState === "working"}>
              <div style={{ padding: "6px 0", color: "var(--ink-3)", "font-size": "11.5px" }}>
                <span class="cursor"></span>{" "}
                <span class="ink-faint">claude is typing…</span>
              </div>
            </Show>
            <Show when={props.tailing && props.chatState === "waiting"}>
              <div
                class="ink-faint"
                style={{ padding: "6px 0", "font-size": "11.5px", "font-style": "italic" }}
              >
                waiting for your input…
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default ConversationView;
