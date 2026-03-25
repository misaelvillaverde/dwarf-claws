import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import "./styles/global.css";
import { listSessions, getSessionMessages, searchSessions } from "./lib/api";
import type { UnifiedSession, UnifiedMessage } from "./lib/types";
import SessionList from "./components/SessionList";
import ConversationView from "./components/ConversationView";
import SessionDetail from "./components/SessionDetail";
import StatusBar from "./components/StatusBar";

function App() {
  const [sessions, setSessions] = createSignal<UnifiedSession[]>([]);
  const [selectedSession, setSelectedSession] = createSignal<UnifiedSession | null>(null);
  const [messages, setMessages] = createSignal<UnifiedMessage[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [sourceFilter, setSourceFilter] = createSignal<string | null>(null);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [activePanel, setActivePanel] = createSignal(0); // 0=sessions, 1=conversation, 2=detail

  const ocCount = () => sessions().filter((s) => s.source === "OpenClaw").length;
  const ccCount = () => sessions().filter((s) => s.source === "ClaudeCode").length;

  const loadSessions = async (filter?: string | null) => {
    try {
      const result = await listSessions(filter ?? undefined);
      setSessions(result);
    } catch (e) {
      console.error("Failed to load sessions:", e);
    }
  };

  const selectSession = async (session: UnifiedSession) => {
    setSelectedSession(session);
    setLoading(true);
    try {
      const msgs = await getSessionMessages(session.id, session.source);
      setMessages(msgs);
    } catch (e) {
      console.error("Failed to load messages:", e);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      loadSessions(sourceFilter());
      return;
    }
    try {
      const result = await searchSessions(query);
      // Apply source filter client-side
      const filter = sourceFilter();
      if (filter === "openclaw") {
        setSessions(result.filter((s) => s.source === "OpenClaw"));
      } else if (filter === "claude_code") {
        setSessions(result.filter((s) => s.source === "ClaudeCode"));
      } else {
        setSessions(result);
      }
    } catch (e) {
      console.error("Failed to search:", e);
    }
  };

  const handleFilterChange = (filter: string | null) => {
    setSourceFilter(filter);
    loadSessions(filter);
  };

  // Keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    // Don't handle if typing in an input
    if ((e.target as HTMLElement).tagName === "INPUT") {
      if (e.key === "Escape") {
        (e.target as HTMLElement).blur();
      }
      return;
    }

    const s = sessions();

    switch (e.key) {
      case "j":
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, s.length - 1));
        if (s[selectedIndex()]) selectSession(s[selectedIndex()]);
        break;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        if (s[selectedIndex()]) selectSession(s[selectedIndex()]);
        break;
      case "Enter":
        if (s[selectedIndex()]) selectSession(s[selectedIndex()]);
        break;
      case "/":
        e.preventDefault();
        const input = document.querySelector("input");
        if (input) input.focus();
        break;
      case "Tab":
        e.preventDefault();
        setActivePanel((p) => (p + 1) % 3);
        break;
    }
  };

  onMount(() => {
    loadSessions();
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  const sessionName = () => {
    const s = selectedSession();
    if (!s) return null;
    return s.display_name || s.slug || s.id.slice(0, 8);
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100vh",
        padding: "4px",
        gap: "4px",
      }}
    >
      {/* Title bar */}
      <div
        style={{
          "text-align": "center",
          padding: "2px 0",
          color: "var(--border-bright)",
          "font-weight": "bold",
          "letter-spacing": "2px",
          "border-bottom": "1px solid var(--border)",
        }}
      >
        {"=[ DWARF CLAWS ]="}
      </div>

      {/* 3-panel layout */}
      <div
        style={{
          display: "flex",
          flex: 1,
          gap: "4px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: "25%",
            "min-width": "200px",
            display: "flex",
          }}
        >
          <SessionList
            sessions={sessions()}
            selectedId={selectedSession()?.id ?? null}
            onSelect={(s) => {
              const idx = sessions().findIndex((x) => x.id === s.id);
              setSelectedIndex(idx >= 0 ? idx : 0);
              selectSession(s);
            }}
            onSearch={handleSearch}
            sourceFilter={sourceFilter()}
            onFilterChange={handleFilterChange}
          />
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            "min-width": 0,
          }}
        >
          <ConversationView
            messages={messages()}
            loading={loading()}
            sessionName={sessionName()}
          />
        </div>
        <div
          style={{
            width: "20%",
            "min-width": "160px",
            display: "flex",
          }}
        >
          <SessionDetail session={selectedSession()} />
        </div>
      </div>

      {/* Status bar */}
      <StatusBar ocCount={ocCount()} ccCount={ccCount()} />
    </div>
  );
}

export default App;
