import { createSignal, createMemo, createEffect, onMount, onCleanup, Show, For } from "solid-js";
import "./styles/global.css";
import "./styles/modern.css";
import { listSessions, getSessionData, getSessionMessagesSince, searchSessions, searchMessages, probeTmux, sendTmuxKeys, captureTmuxPane, type TmuxProbe } from "./lib/api";
import type { UnifiedSession, UnifiedMessage, ToolStat } from "./lib/types";
import CCList from "./components/CCList";
import ConversationView from "./components/ConversationView";
import SessionDetail from "./components/SessionDetail";
import StatusBar from "./components/StatusBar";
import Composer from "./components/Composer";
import CommandPalette, { type Command } from "./components/CommandPalette";
import ContextMenu, { type MenuItem } from "./components/ContextMenu";
import RenameDialog from "./components/RenameDialog";
import ModernApp from "./components/ModernApp";
import ModeBar from "./components/ModeBar";
import PendingToolBar from "./components/PendingToolBar";
import TmuxBindingPicker from "./components/TmuxBindingPicker";
import { sendToTmuxPane } from "./lib/api";
import logoUrl from "./assets/logo.png";
import { customNameFor, setCustomName } from "./lib/customNames";
import { tmuxBindings, setTmuxBinding } from "./lib/tmuxBindings";
import { parsePromptOptions } from "./lib/promptDetection";
import { setToolDecision } from "./lib/toolDecisions";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { chatState, ChatState, computePendingTools, projectName, sessionName as resolveSessionName, THIRTY_MIN } from "./lib/sessionState";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

type Palette = "paper" | "rosepine" | "midnight" | "phosphor" | "amber";
type FontKey = "ibm" | "jetbrains" | "geist" | "space" | "dm" | "fira" | "berkeley" | "departure" | "sharetech" | "vt323";

const PALETTES: { id: Palette; label: string }[] = [
  { id: "paper",    label: "Paper · IBM 3270" },
  { id: "rosepine", label: "Rosé Pine Dawn" },
  { id: "midnight", label: "Midnight" },
  { id: "phosphor", label: "Phosphor · green CRT" },
  { id: "amber",    label: "Amber CRT" },
];

const FONTS: { id: FontKey; label: string }[] = [
  { id: "ibm",       label: "IBM Plex Mono" },
  { id: "jetbrains", label: "JetBrains Mono" },
  { id: "geist",     label: "Geist Mono" },
  { id: "dm",        label: "DM Mono" },
  { id: "fira",      label: "Fira Code" },
  { id: "space",     label: "Space Mono" },
  { id: "sharetech", label: "Share Tech Mono" },
  { id: "vt323",     label: "VT323 · pixel" },
  { id: "berkeley",  label: "Berkeley Mono · local" },
  { id: "departure", label: "Departure Mono · local" },
];

function App() {
  const [sessions, setSessions] = createSignal<UnifiedSession[]>([]);
  const [selectedSession, setSelectedSession] = createSignal<UnifiedSession | null>(null);
  const [messages, setMessages] = createSignal<UnifiedMessage[]>([]);
  const [toolStats, setToolStats] = createSignal<ToolStat[]>([]);

  // Optimistic messages: appended immediately on send, removed when the real
  // message arrives from polling or a fresh session load.
  const [pendingMsgs, setPendingMsgs] = createSignal<{ id: string; sessionId: string; text: string }[]>([]);

  const addOptimistic = (sessionId: string, text: string) => {
    const id = `opt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPendingMsgs(p => [...p, { id, sessionId, text }]);
    // Safety net: drop if not matched within 30 s.
    setTimeout(() => setPendingMsgs(p => p.filter(m => m.id !== id)), 30_000);
  };

  const flushOptimistic = (sessionId: string, newMsgs: UnifiedMessage[]) => {
    const realTexts = newMsgs
      .filter(m => m.role === "User")
      .flatMap(m => m.content)
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map(b => b.text.trim());
    if (!realTexts.length) return;
    const pool = [...realTexts];
    setPendingMsgs(prev => prev.filter(o => {
      if (o.sessionId !== sessionId) return true;
      const idx = pool.findIndex(t => t === o.text.trim());
      if (idx === -1) return true;
      pool.splice(idx, 1);
      return false;
    }));
  };

  const visibleMessages = createMemo((): UnifiedMessage[] => {
    const sel = selectedSession();
    const base = messages();
    if (!sel) return base;
    const pending = pendingMsgs()
      .filter(o => o.sessionId === sel.id)
      .map(o => ({
        id: o.id,
        role: "User" as const,
        content: [{ type: "text" as const, text: o.text }],
        timestamp: new Date().toISOString(),
        model: null as null,
        _optimistic: true as const,
      }));
    return pending.length ? [...base, ...pending] : base;
  });
  const [loading, setLoading] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [focusedRowIndex, setFocusedRowIndex] = createSignal<number>(-1);
  const [pinnedSessionIds, setPinnedSessionIds] = createSignal<Set<string>>(new Set());
  const [highlightedSessionIds, setHighlightedSessionIds] = createSignal<Set<string> | null>(null);
  const [inboxOnly, setInboxOnly] = createSignal(false);
  const [projectFilter, setProjectFilter] = createSignal<string>("__all");
  const [autoMode, setAutoMode] = createSignal(true);
  const [palette, setPalette] = createSignal<Palette>(
    (localStorage.getItem("dwarf-claws-palette") as Palette) || "paper"
  );
  const [font, setFont] = createSignal<FontKey>(
    (localStorage.getItem("dwarf-claws-font") as FontKey) || "ibm"
  );
  const [customFont, setCustomFont] = createSignal<string | null>(
    localStorage.getItem("dwarf-claws-font-custom")
  );
  const [fontScale, setFontScale] = createSignal<number>(
    parseFloat(localStorage.getItem("dwarf-claws-font-scale") || "1") || 1
  );
  const [detailWidth, setDetailWidth] = createSignal<number>(
    parseInt(localStorage.getItem("dwarf-claws-detail-width") || "540", 10) || 540
  );
  const [detailHeight, setDetailHeight] = createSignal<number>(
    parseInt(localStorage.getItem("dwarf-claws-detail-height") || "280", 10) || 280
  );

  let vResizeStartY = 0;
  let vResizeStartHeight = 0;
  const onVResizeMove = (e: MouseEvent) => {
    const dy = e.clientY - vResizeStartY;
    const next = Math.max(120, Math.min(window.innerHeight - 220, vResizeStartHeight + dy));
    setDetailHeight(next);
  };
  const onVResizeEnd = () => {
    document.removeEventListener("mousemove", onVResizeMove);
    document.removeEventListener("mouseup", onVResizeEnd);
    document.body.style.cursor = "";
    localStorage.setItem("dwarf-claws-detail-height", String(detailHeight()));
  };
  const onVResizeStart = (e: MouseEvent) => {
    e.preventDefault();
    vResizeStartY = e.clientY;
    vResizeStartHeight = detailHeight();
    document.body.style.cursor = "row-resize";
    document.addEventListener("mousemove", onVResizeMove);
    document.addEventListener("mouseup", onVResizeEnd);
  };

  let resizeStartX = 0;
  let resizeStartWidth = 0;
  const onResizeMove = (e: MouseEvent) => {
    const dx = e.clientX - resizeStartX;
    const next = Math.max(320, Math.min(window.innerWidth - 300, resizeStartWidth - dx));
    setDetailWidth(next);
  };
  const onResizeEnd = () => {
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeEnd);
    document.body.style.cursor = "";
    localStorage.setItem("dwarf-claws-detail-width", String(detailWidth()));
  };
  const onResizeStart = (e: MouseEvent) => {
    e.preventDefault();
    resizeStartX = e.clientX;
    resizeStartWidth = detailWidth();
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onResizeMove);
    document.addEventListener("mouseup", onResizeEnd);
  };
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [clockTick, setClockTick] = createSignal(Date.now());
  const [tmuxStatus, setTmuxStatus] = createSignal<TmuxProbe | null>(null);
  const [viewMode, setViewMode] = createSignal<"list" | "grid">(
    (localStorage.getItem("dwarf-claws-view-mode") as "list" | "grid") || "list"
  );
  const [uiMode, setUiMode] = createSignal<"terminal" | "modern">(
    (localStorage.getItem("dwarf-claws-ui-mode") as "terminal" | "modern") || "modern"
  );

  // Modern light/dark mode is derived from the palette (paper/rosepine = light, midnight/phosphor/amber = dark).
  const isPaletteDark = (p: Palette): boolean => p === "midnight" || p === "phosphor" || p === "amber";

  createEffect(() => {
    document.documentElement.setAttribute("data-mode", uiMode());
    document.documentElement.setAttribute("data-theme", isPaletteDark(palette()) ? "dark" : "light");
    localStorage.setItem("dwarf-claws-ui-mode", uiMode());
  });
  const [ctxMenu, setCtxMenu] = createSignal<{ session: UnifiedSession; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = createSignal<UnifiedSession | null>(null);
  const [bindingFor, setBindingFor] = createSignal<UnifiedSession | null>(null);

  const openContextMenu = (session: UnifiedSession, x: number, y: number) => {
    setCtxMenu({ session, x, y });
  };

  const openBindingPicker = (s: UnifiedSession) => setBindingFor(s);

  const ctxItems = (): MenuItem[] => {
    const m = ctxMenu();
    if (!m) return [];
    const s = m.session;
    const items: MenuItem[] = [];
    items.push({
      id: "rename",
      label: customNameFor(s.id) ? "Edit custom name…" : "Rename…",
      run: () => setRenaming(s),
    });
    if (customNameFor(s.id)) {
      items.push({
        id: "reset-name",
        label: "Reset name",
        run: () => setCustomName(s.id, null),
      });
    }
    items.push({
      id: "pin",
      label: pinnedSessionIds().has(s.id) ? "Unpin" : "Pin",
      run: () => togglePin(s.id),
    });
    if (s.jsonl_path) {
      items.push({
        id: "reveal",
        label: "Reveal JSONL in Finder",
        run: () => {
          revealItemInDir(s.jsonl_path!).catch(e => console.warn("reveal failed", e));
        },
      });
      items.push({
        id: "copy-path",
        label: "Copy JSONL path",
        run: () => navigator.clipboard.writeText(s.jsonl_path!).catch(() => {}),
      });
    }
    if (s.tmux_pane) {
      items.push({
        id: "copy-tmux",
        label: "Copy tmux switch cmd",
        run: () => navigator.clipboard.writeText(`tmux switch-client -t ${s.tmux_pane}`).catch(() => {}),
      });
    }
    items.push({
      id: "bind-tmux",
      label: tmuxBindings()[s.id] ? "Re-bind tmux pane…" : "Bind tmux pane…",
      run: () => openBindingPicker(s),
    });
    if (tmuxBindings()[s.id]) {
      items.push({
        id: "clear-tmux-binding",
        label: "Clear tmux binding",
        run: () => setTmuxBinding(s.id, null),
      });
    }
    items.push({
      id: "copy-id",
      label: "Copy session id",
      run: () => navigator.clipboard.writeText(s.id).catch(() => {}),
    });
    return items;
  };

  createEffect(() => {
    localStorage.setItem("dwarf-claws-view-mode", viewMode());
  });

  const refreshTmuxStatus = async () => {
    try {
      setTmuxStatus(await probeTmux());
    } catch (e) {
      console.warn("probeTmux failed", e);
    }
  };

  const applyPalette = (p: Palette) => {
    document.documentElement.setAttribute("data-palette", p);
    localStorage.setItem("dwarf-claws-palette", p);
  };

  const applyFont = (f: FontKey, custom: string | null) => {
    document.documentElement.setAttribute("data-font", f);
    if (custom && custom.trim()) {
      document.documentElement.style.setProperty(
        "--font",
        `"${custom.trim()}", "IBM Plex Mono", ui-monospace, monospace`
      );
      localStorage.setItem("dwarf-claws-font-custom", custom.trim());
    } else {
      document.documentElement.style.removeProperty("--font");
      localStorage.removeItem("dwarf-claws-font-custom");
    }
    localStorage.setItem("dwarf-claws-font", f);
  };

  const applyFontScale = (s: number) => {
    const clamped = Math.max(0.5, Math.min(3, s));
    document.documentElement.style.setProperty("--font-scale", String(clamped));
    localStorage.setItem("dwarf-claws-font-scale", String(clamped));
  };

  createEffect(() => applyPalette(palette()));
  createEffect(() => applyFont(font(), customFont()));
  createEffect(() => applyFontScale(fontScale()));

  const zoomIn = () => setFontScale(s => Math.min(3, +(s + 0.1).toFixed(2)));
  const zoomOut = () => setFontScale(s => Math.max(0.5, +(s - 0.1).toFixed(2)));
  const zoomReset = () => setFontScale(1);

  const cyclePalette = () => {
    const i = PALETTES.findIndex(p => p.id === palette());
    setPalette(PALETTES[(i + 1) % PALETTES.length].id);
  };

  // Apply user-set manual tmux bindings on top of whatever the backend
  // resolved. The override wins so users can fix wrong cwd-based guesses.
  const boundSessions = createMemo<UnifiedSession[]>(() => {
    const bound = tmuxBindings();
    return sessions().map(s => {
      const pane = bound[s.id];
      if (!pane) return s;
      return { ...s, tmux_pane: pane, pane_source: "manual" };
    });
  });

  // Keep selectedSession in sync when bindings change for the active session.
  createEffect(() => {
    const sel = selectedSession();
    if (!sel) return;
    const updated = boundSessions().find(s => s.id === sel.id);
    if (updated && (updated.tmux_pane !== sel.tmux_pane || updated.pane_source !== sel.pane_source)) {
      setSelectedSession(updated);
    }
  });

  const visibleSessions = createMemo(() => {
    const pinned = pinnedSessionIds();
    const now = Date.now();
    return boundSessions().filter(s => {
      const ts = s.updated_at ?? 0;
      const age = now - ts;
      const hidden = age >= 2 * 24 * 60 * 60 * 1000;
      return !hidden || pinned.has(s.id);
    });
  });

  const projectGroups = createMemo<[string, number][]>(() => {
    const map = new Map<string, number>();
    for (const s of visibleSessions()) {
      const k = s.cwd || s.project_path || "(no path)";
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  });

  const sortedSessions = createMemo(() => {
    const q = searchQuery().trim().toLowerCase();
    const qFilter = q.startsWith("!") ? "" : q;
    const pf = projectFilter();
    const inbox = inboxOnly();
    const annotated = visibleSessions()
      .filter(s => pf === "__all" || (s.cwd || s.project_path || "(no path)") === pf)
      .map(s => ({ s, state: chatState(s), pending: !!s.pending_tool_use }))
      .filter(t => !inbox || t.state === "waiting" || t.pending)
      .filter(t => {
        if (!qFilter) return true;
        const name = (t.s.display_name || t.s.first_user_message_preview || t.s.id).toLowerCase();
        return name.includes(qFilter);
      });
    const order: Record<ChatState, number> = { waiting: 0, working: 1, idle: 2 };
    annotated.sort((a, b) => {
      if (a.pending !== b.pending) return a.pending ? -1 : 1;
      const o = order[a.state] - order[b.state];
      if (o !== 0) return o;
      return (b.s.updated_at ?? 0) - (a.s.updated_at ?? 0);
    });
    return annotated.map(t => t.s);
  });

  const pendingList = createMemo(() => computePendingTools(messages()));
  const pendingIds = createMemo(() => new Set(pendingList().map((p) => p.id)));
  const firstPendingId = createMemo(() => pendingList()[0]?.id ?? null);

  const dispatchPendingKey = async (key: "1" | "2" | "3") => {
    const s = selectedSession();
    const pane = s?.tmux_pane;
    if (!pane || pendingList().length === 0) return;
    const first = pendingList()[0];
    if (!first) return;
    if (first.ts > 0 && Date.now() - first.ts < 2000) return;
    // Capture BEFORE sending so we know what each option means.
    let intent: "allow" | "always" | "deny" | null = null;
    try {
      const text = await captureTmuxPane(pane);
      const parsed = parsePromptOptions(text);
      if (parsed.allow === key) intent = "allow";
      else if (parsed.always === key) intent = "always";
      else if (parsed.deny === key) intent = "deny";
    } catch { /* fall through — we'll still send the key */ }
    try {
      await sendTmuxKeys(pane, [key]);
      if (intent) setToolDecision(first.id, intent);
    } catch (e) {
      console.warn("sendTmuxKeys failed", e);
    }
  };

  const inboxCount = createMemo(() =>
    visibleSessions().filter(s => chatState(s) === "waiting").length
  );

  const counts = createMemo(() => {
    const now = Date.now();
    let active = 0, waiting = 0, idle = 0;
    const projects = new Set<string>();
    for (const s of visibleSessions()) {
      const ts = s.updated_at ?? 0;
      const age = now - ts;
      if (age < THIRTY_MIN) {
        if (s.last_message_role === "assistant") waiting++;
        else active++;
      } else {
        idle++;
      }
      projects.add(s.project_path ?? s.cwd ?? "COMMONS");
    }
    return { roomCount: Math.max(1, projects.size), active, idle, waiting };
  });

  const prevState = new Map<string, ChatState>();
  let initialPollDone = false;

  const fireTransitionNotifications = (list: UnifiedSession[]) => {
    const now = Date.now();
    const seed = !initialPollDone;
    let firstWaiting: UnifiedSession | null = null;
    for (const s of list) {
      const curr = chatState(s, now);
      const prev = prevState.get(s.id);
      if (!seed && prev === "working" && curr === "waiting") {
        const title = `Claude Code · ${projectName(s.project_path)}`;
        const body = (s.display_name || s.first_user_message_preview || s.id.slice(0, 8)).slice(0, 120);
        try {
          sendNotification({ title, body });
        } catch (e) {
          console.warn("Notification failed:", e);
        }
        if (!firstWaiting) firstWaiting = s;
      }
      prevState.set(s.id, curr);
    }
    if (seed) initialPollDone = true;

    if (autoMode() && firstWaiting && !selectedSession()) {
      selectSessionWithTail(firstWaiting);
    }
  };

  let allLoadedSessions: UnifiedSession[] = [];

  const loadSessions = async () => {
    try {
      const result = await listSessions();
      allLoadedSessions = result;
      setSessions(result);
      fireTransitionNotifications(result);
    } catch (e) {
      console.error("Failed to load sessions:", e);
    }
  };

  const selectSession = async (session: UnifiedSession) => {
    setSelectedSession(session);
    setLoading(true);
    try {
      const data = await getSessionData(session.id);
      flushOptimistic(session.id, data.messages);
      setMessages(data.messages);
      setToolStats(data.tool_stats);
    } catch (e) {
      console.error("Failed to load session data:", e);
      setMessages([]);
      setToolStats([]);
    } finally {
      setLoading(false);
    }
  };

  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  const executeSearch = async (query: string) => {
    if (query.startsWith("!")) {
      const msgQuery = query.slice(1).trim();
      if (!msgQuery) {
        setHighlightedSessionIds(null);
        return;
      }
      try {
        const results = await searchMessages(msgQuery);
        const ids = new Set<string>(results.map(r => r.session_id));
        setHighlightedSessionIds(ids);
      } catch (e) {
        console.error("Failed to search messages:", e);
      }
      return;
    }

    setHighlightedSessionIds(null);
    try {
      const rustResult = await searchSessions(query);
      // Also match custom names (frontend-only localStorage) against the full session list.
      const q = query.toLowerCase();
      const rustIds = new Set(rustResult.map(s => s.id));
      const customMatches = allLoadedSessions.filter(s => {
        if (rustIds.has(s.id)) return false;
        const cn = customNameFor(s.id);
        return !!cn && cn.toLowerCase().includes(q);
      });
      setSessions([...rustResult, ...customMatches]);
    } catch (e) {
      console.error("Failed to search:", e);
    }
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    clearTimeout(searchTimer);
    if (!query.trim()) {
      setHighlightedSessionIds(null);
      loadSessions();
      return;
    }
    searchTimer = setTimeout(() => executeSearch(query), 250);
  };

  const togglePin = (sessionId: string) => {
    setPinnedSessionIds(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  let lastKeyG = 0;

  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setPaletteOpen(v => !v);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      zoomIn();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "-") {
      e.preventDefault();
      zoomOut();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "0") {
      e.preventDefault();
      zoomReset();
      return;
    }

    if (paletteOpen()) return;

    const tag = (e.target as HTMLElement)?.tagName || "";
    if (tag.match(/INPUT|TEXTAREA/)) {
      if (e.key === "Escape") (e.target as HTMLElement).blur();
      return;
    }

    const list = sortedSessions();

    if (pendingList().length > 0 && (e.key === "1" || e.key === "2" || e.key === "3")) {
      e.preventDefault();
      dispatchPendingKey(e.key as "1" | "2" | "3");
      return;
    }

    switch (e.key) {
      case "/":
        e.preventDefault();
        document.querySelector<HTMLInputElement>("#dc-search")?.focus();
        break;
      case "i":
        e.preventDefault();
        setInboxOnly(v => !v);
        break;
      case "j": {
        e.preventDefault();
        if (list.length === 0) return;
        const cur = focusedRowIndex();
        setFocusedRowIndex(Math.min(list.length - 1, cur < 0 ? 0 : cur + 1));
        break;
      }
      case "k": {
        e.preventDefault();
        if (list.length === 0) return;
        const cur = focusedRowIndex();
        setFocusedRowIndex(Math.max(0, cur <= 0 ? 0 : cur - 1));
        break;
      }
      case "h":
      case "l": {
        // In grid view, h/l moves between cards on the same row.
        // In list view they're a no-op.
        if (viewMode() !== "grid" || list.length === 0) return;
        e.preventDefault();
        const cur = focusedRowIndex();
        if (cur < 0) return;
        // Discover columns by sampling DOM rects.
        const cards = document.querySelectorAll<HTMLElement>("[data-card-index]");
        if (cards.length === 0) return;
        const curEl = document.querySelector<HTMLElement>(`[data-card-index="${cur}"]`);
        if (!curEl) return;
        const curRect = curEl.getBoundingClientRect();
        let bestIdx = cur;
        let bestDx = Infinity;
        cards.forEach((el) => {
          const idx = parseInt(el.dataset.cardIndex || "-1", 10);
          if (idx === cur) return;
          const r = el.getBoundingClientRect();
          // Same row: vertical centers within a card height
          if (Math.abs(r.top - curRect.top) > r.height / 2) return;
          const dx = e.key === "l" ? r.left - curRect.left : curRect.left - r.left;
          if (dx > 0 && dx < bestDx) {
            bestDx = dx;
            bestIdx = idx;
          }
        });
        if (bestIdx !== cur) setFocusedRowIndex(bestIdx);
        break;
      }
      case "g": {
        e.preventDefault();
        if (list.length === 0) return;
        const now = Date.now();
        if (now - lastKeyG < 500) {
          setFocusedRowIndex(0);
          lastKeyG = 0;
        } else {
          lastKeyG = now;
        }
        break;
      }
      case "G": {
        e.preventDefault();
        if (list.length === 0) return;
        setFocusedRowIndex(list.length - 1);
        break;
      }
      case "Enter": {
        const idx = focusedRowIndex();
        if (idx >= 0 && idx < list.length) {
          selectSessionWithTail(list[idx]);
        }
        break;
      }
      case "Escape":
        setInboxOnly(false);
        setSearchQuery("");
        setFocusedRowIndex(-1);
        break;
    }
  };

  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let clockInterval: ReturnType<typeof setInterval> | null = null;
  let tailInterval: ReturnType<typeof setInterval> | null = null;
  const [tailing, setTailing] = createSignal(false);

  const startTailing = () => {
    if (tailInterval) clearInterval(tailInterval);
    tailInterval = setInterval(async () => {
      const s = selectedSession();
      if (!s) return;
      if (chatState(s) === "idle") {
        setTailing(false);
        if (tailInterval) clearInterval(tailInterval);
        return;
      }
      try {
        const currentLen = messages().length;
        const newMsgs = await getSessionMessagesSince(s.id, currentLen);
        if (newMsgs.length > 0) {
          flushOptimistic(s.id, newMsgs);
          setMessages(prev => [...prev, ...newMsgs]);
        }
      } catch { /* ignore */ }
    }, 5000);
    setTailing(true);
  };

  const stopTailing = () => {
    if (tailInterval) clearInterval(tailInterval);
    tailInterval = null;
    setTailing(false);
  };

  const selectSessionWithTail = async (session: UnifiedSession) => {
    stopTailing();
    await selectSession(session);
    if (chatState(session) !== "idle") startTailing();
  };

  onMount(async () => {
    applyPalette(palette());
    loadSessions();
    refreshTmuxStatus();
    document.addEventListener("keydown", handleKeyDown);
    refreshInterval = setInterval(() => {
      if (document.hidden) return;
      loadSessions();
      refreshTmuxStatus();
    }, 30000);
    clockInterval = setInterval(() => setClockTick(Date.now()), 30000);

    try {
      const stored = localStorage.getItem("dwarf-claws-pins");
      if (stored) setPinnedSessionIds(new Set<string>(JSON.parse(stored)));
    } catch { /* ignore */ }

    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const perm = await requestPermission();
        granted = perm === "granted";
      }
      if (!granted) {
        console.warn("Notification permission not granted");
      }
    } catch (e) {
      console.warn("Notification setup failed:", e);
    }
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
    if (refreshInterval) clearInterval(refreshInterval);
    if (clockInterval) clearInterval(clockInterval);
    stopTailing();
  });

  createEffect(() => {
    const ids = pinnedSessionIds();
    localStorage.setItem("dwarf-claws-pins", JSON.stringify([...ids]));
  });

  const sessionName = () => {
    const s = selectedSession();
    if (!s) return null;
    return resolveSessionName(s);
  };

  const commands = createMemo<Command[]>(() => {
    const themeChildren: Command[] = PALETTES.map(p => ({
      id: `theme.${p.id}`,
      title: p.label,
      hint: palette() === p.id ? "current" : undefined,
      run: () => { setPalette(p.id); },
    }));

    const fontChildren: Command[] = FONTS.map(f => ({
      id: `font.${f.id}`,
      title: f.label,
      hint: font() === f.id && !customFont() ? "current" : undefined,
      run: () => { setCustomFont(null); setFont(f.id); },
    }));
    fontChildren.push({
      id: "font.custom",
      title: customFont() ? `Custom (${customFont()})…` : "Custom local font…",
      hint: customFont() ? "current" : undefined,
      run: () => {},
      prompt: {
        placeholder: "Type font family (e.g. Berkeley Mono)",
        apply: (value) => { setCustomFont(value); },
      },
    });
    if (customFont()) {
      fontChildren.push({
        id: "font.custom.clear",
        title: "Clear custom",
        run: () => { setCustomFont(null); },
      });
    }

    const uiChildren: Command[] = [
      {
        id: "ui.modern",
        title: "Modern",
        hint: uiMode() === "modern" ? "current" : undefined,
        run: () => { setUiMode("modern"); },
      },
      {
        id: "ui.terminal",
        title: "Terminal",
        hint: uiMode() === "terminal" ? "current" : undefined,
        run: () => { setUiMode("terminal"); },
      },
    ];

    const viewChildren: Command[] = [
      {
        id: "view.list",
        title: "List",
        hint: viewMode() === "list" ? "current" : undefined,
        run: () => { setViewMode("list"); },
      },
      {
        id: "view.grid",
        title: "Grid",
        hint: viewMode() === "grid" ? "current" : undefined,
        run: () => { setViewMode("grid"); },
      },
    ];

    const zoomChildren: Command[] = [
      { id: "zoom.in",    title: "Zoom in",    hint: "⌘+", run: () => { zoomIn(); } },
      { id: "zoom.out",   title: "Zoom out",   hint: "⌘-", run: () => { zoomOut(); } },
      { id: "zoom.reset", title: `Reset (${Math.round(fontScale() * 100)}%)`, hint: "⌘0", run: () => { zoomReset(); } },
    ];

    return [
      {
        id: "actions",
        title: "Actions",
        children: [
          {
            id: "inbox.toggle",
            title: inboxOnly() ? "Show all sessions" : "Show only waiting (inbox)",
            hint: "i",
            run: () => { setInboxOnly(v => !v); },
          },
          {
            id: "auto.toggle",
            title: autoMode() ? "Disable auto-jump" : "Enable auto-jump",
            run: () => { setAutoMode(v => !v); },
          },
          {
            id: "search.focus",
            title: "Focus search",
            hint: "/",
            run: () => { document.querySelector<HTMLInputElement>("#dc-search")?.focus(); },
          },
          {
            id: "sessions.reload",
            title: "Reload sessions",
            run: () => { loadSessions(); },
          },
        ],
      },
      { id: "ui",    title: "UI",     children: uiChildren },
      { id: "view",  title: "View",   children: viewChildren },
      { id: "theme", title: "Theme",  children: themeChildren },
      { id: "font",  title: "Font",   children: fontChildren },
      { id: "zoom",  title: "Zoom",   children: zoomChildren },
    ];
  });

  const clockLabel = () => {
    const d = new Date(clockTick());
    return d.toLocaleString([], {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  };

  return (
    <Show
      when={uiMode() === "modern"}
      fallback={renderTerminal()}
    >
      <ModernApp
        sessions={visibleSessions()}
        sortedSessions={sortedSessions()}
        selectedSession={selectedSession()}
        focusedIndex={focusedRowIndex()}
        messages={visibleMessages()}
        toolStats={toolStats()}
        loading={loading()}
        tailing={tailing()}
        searchQuery={searchQuery()}
        inboxOnly={inboxOnly()}
        viewMode={viewMode()}
        pinnedSessionIds={pinnedSessionIds()}
        inboxCount={inboxCount()}
        counts={counts()}
        clockLabel={clockLabel()}
        palette={palette()}
        projectFilter={projectFilter()}
        projectGroups={projectGroups()}
        pendingList={pendingList()}
        pendingIds={pendingIds()}
        firstPendingId={firstPendingId()}
        onSetProjectFilter={setProjectFilter}
        onSelect={selectSessionWithTail}
        onContextMenu={openContextMenu}
        onSearch={handleSearch}
        onToggleInbox={() => setInboxOnly(v => !v)}
        onSetViewMode={setViewMode}
        onToggleTail={() => tailing() ? stopTailing() : startTailing()}
        onTogglePin={togglePin}
        onSwitchToTerminal={() => setUiMode("terminal")}
        onSendTmux={async (pane, text) => {
          const sid = selectedSession()?.id;
          if (sid) addOptimistic(sid, text);
          await sendToTmuxPane(pane, text);
        }}
        onOpenPalette={() => setPaletteOpen(true)}
        detailWidth={detailWidth()}
        detailHeight={detailHeight()}
        onResizeStart={onResizeStart}
        onVResizeStart={onVResizeStart}
        onRequestBind={openBindingPicker}
      />
      <CommandPalette open={paletteOpen()} commands={commands()} onClose={() => setPaletteOpen(false)} />
      <ContextMenu
        open={!!ctxMenu()}
        x={ctxMenu()?.x ?? 0}
        y={ctxMenu()?.y ?? 0}
        items={ctxItems()}
        onClose={() => setCtxMenu(null)}
      />
      <RenameDialog
        open={!!renaming()}
        initial={renaming() ? (customNameFor(renaming()!.id) || "") : ""}
        title={renaming() ? (renaming()!.display_name || renaming()!.slug || renaming()!.id) : ""}
        onSave={(name) => {
          const r = renaming();
          if (r) setCustomName(r.id, name);
        }}
        onClose={() => setRenaming(null)}
      />
      <TmuxBindingPicker
        open={!!bindingFor()}
        sessionId={bindingFor()?.id ?? ""}
        sessionCwd={bindingFor()?.cwd ?? null}
        currentPane={bindingFor()?.tmux_pane ?? null}
        onPick={(pane) => {
          const s = bindingFor();
          if (s) setTmuxBinding(s.id, pane);
        }}
        onClose={() => setBindingFor(null)}
      />
    </Show>
  );

  function renderTerminal() { return (
    <div style={{
      height: "100vh",
      display: "flex",
      "flex-direction": "column",
      background: "var(--paper)",
      color: "var(--ink)",
    }}>
      {/* Title bar */}
      <div
        class="titlebar-drag"
        data-tauri-drag-region
        style={{
          display: "flex",
          "align-items": "center",
          gap: "12px",
          padding: "8px 12px 8px 78px",
          "border-bottom": "1px solid var(--rule)",
          background: "var(--paper)",
        }}
      >
        <img
          src={logoUrl}
          alt="Dwarf Claws"
          style={{
            width: "22px",
            height: "22px",
            "border-radius": "5px",
            flex: "0 0 auto",
          }}
        />
        <span style={{
          "font-weight": 700,
          "letter-spacing": "0.18em",
          "font-size": "12px",
          color: "var(--ink)",
          flex: "0 0 auto",
        }}>
          DWARF CLAWS
        </span>
        <span class="ink-faint" style={{ "font-size": "11px", flex: "0 0 auto" }}>
          {clockLabel()}
        </span>

        <Show when={tmuxStatus()}>
          {(t) => {
            const ok = () => t().server_running && t().pane_count > 0;
            const tip = () => {
              if (t().error) return `tmux error: ${t().error}`;
              if (!t().bin) return "tmux binary not found";
              if (!t().server_running) return "tmux server not running";
              return `tmux ok · ${t().pane_count} panes · ${t().bin}`;
            };
            return (
              <span
                title={tip()}
                style={{
                  "font-size": "10.5px",
                  padding: "0 6px",
                  border: "1px solid currentColor",
                  height: "16px",
                  display: "inline-flex",
                  "align-items": "center",
                  gap: "4px",
                  color: ok() ? "var(--ok)" : "var(--warn)",
                }}
              >
                <span style={{
                  width: "6px", height: "6px",
                  "border-radius": "50%",
                  background: "currentColor",
                }}></span>
                tmux:{t().pane_count}
              </span>
            );
          }}
        </Show>

        <button
          class={inboxOnly() ? "active" : ""}
          onClick={() => setInboxOnly(v => !v)}
          style={{
            "margin-left": "8px",
            "white-space": "nowrap",
            flex: "0 0 auto",
            color: inboxCount() > 0 ? "var(--warn)" : "var(--ink-3)",
            "border-color": inboxCount() > 0 ? "var(--warn)" : "var(--rule)",
            "-webkit-app-region": "no-drag",
          }}
          title="show only sessions waiting for input (i)"
        >
          <span style={{
            display: "inline-block", width: "6px", height: "6px",
            "border-radius": "50%", background: "currentColor",
          }}></span>
          <span style={{ "margin-left": "4px" }}>{inboxCount()} need input</span>
        </button>

        <div style={{
          "margin-left": "auto",
          display: "flex",
          gap: "8px",
          "-webkit-app-region": "no-drag",
          width: "480px",
        }}>
          <div style={{ position: "relative", flex: 1 }}>
            <span style={{
              position: "absolute", left: "8px", top: "4px",
              color: "var(--ink-4)", "font-size": "11px",
            }}>/</span>
            <input
              id="dc-search"
              type="text"
              placeholder="search session names · prefix with ! to search messages"
              value={searchQuery()}
              onInput={(e) => handleSearch(e.currentTarget.value)}
              style={{ "padding-left": "18px", width: "100%" }}
            />
          </div>
          <button
            onClick={() => setViewMode(v => v === "list" ? "grid" : "list")}
            title={`switch to ${viewMode() === "list" ? "grid" : "list"} view`}
          >
            {viewMode() === "list" ? "▤ list" : "▦ grid"}
          </button>
          <button
            class={autoMode() ? "active" : ""}
            onClick={() => setAutoMode(a => !a)}
            title="Auto-jump to sessions that need input"
          >
            {autoMode() ? "● auto" : "○ auto"}
          </button>
          <button onClick={cyclePalette} title="cycle palette">
            {palette()}
          </button>
          <button onClick={() => setUiMode("modern")} title="switch to Modern UI">
            modern
          </button>
          <button onClick={() => setPaletteOpen(true)} title="open command palette (⌘K)">
            ⌘K
          </button>
        </div>
      </div>

      {/* Project tabs */}
      <div style={{
        display: "flex",
        "align-items": "center",
        gap: "4px",
        padding: "4px 12px",
        "border-bottom": "1px solid var(--rule)",
        "overflow-x": "auto",
        "flex-shrink": 0,
        background: "var(--paper-2)",
      }}>
        <button
          class={projectFilter() === "__all" ? "active" : ""}
          onClick={() => setProjectFilter("__all")}
          style={{ "white-space": "nowrap" }}
        >
          all <span class="ink-faint" style={{ "margin-left": "4px" }}>{visibleSessions().length}</span>
        </button>
        <For each={projectGroups().slice(0, 16)}>
          {(entry: [string, number]) => {
            const path = entry[0];
            const count = entry[1];
            const label = path.split("/").filter(Boolean).pop() || path;
            return (
              <button
                class={projectFilter() === path ? "active" : ""}
                onClick={() => setProjectFilter(path)}
                title={path}
                style={{ "white-space": "nowrap" }}
              >
                {label} <span class="ink-faint" style={{ "margin-left": "4px" }}>{count}</span>
              </button>
            );
          }}
        </For>
      </div>

      {/* Main two-column body */}
      <div style={{
        display: "flex",
        flex: 1,
        gap: "1px",
        background: "var(--rule)",
        "min-height": 0,
      }}>
        <div class="frame" style={{ flex: 1, "min-width": 0 }}>
          <CCList
            sortedSessions={sortedSessions()}
            selectedId={selectedSession()?.id ?? null}
            focusedIndex={focusedRowIndex()}
            onSelect={selectSessionWithTail}
            onContextMenu={openContextMenu}
            highlightedSessionIds={highlightedSessionIds()}
            pinnedSessionIds={pinnedSessionIds()}
            groupByProject={false}
            viewMode={viewMode()}
            inboxBanner={!inboxOnly() && inboxCount() > 0 ? {
              count: inboxCount(),
              onClick: () => setInboxOnly(true),
            } : null}
          />
        </div>

        <div
          onMouseDown={onResizeStart}
          title="drag to resize"
          style={{
            width: "4px",
            cursor: "col-resize",
            background: "var(--rule)",
            flex: "0 0 auto",
            "user-select": "none",
          }}
        ></div>

        <div class="frame" style={{
          width: `${detailWidth()}px`,
          flex: "0 0 auto",
          display: "flex",
          "flex-direction": "column",
          "min-height": 0,
        }}>
          <Show
            when={selectedSession()}
            fallback={
              <div class="frame-body" style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                color: "var(--ink-4)",
                "font-style": "italic",
                padding: "24px",
                "text-align": "center",
              }}>
                ┄ select a session to peek inside ┄
              </div>
            }
          >
            <div style={{
              height: `${detailHeight()}px`,
              "flex-shrink": 0,
              "overflow-y": "auto",
              "min-height": "120px",
            }}>
              <SessionDetail
                session={selectedSession()}
                toolStats={toolStats()}
                isPinned={selectedSession() ? pinnedSessionIds().has(selectedSession()!.id) : false}
                onTogglePin={() => {
                  const s = selectedSession();
                  if (s) togglePin(s.id);
                }}
                tailing={tailing()}
                onToggleTail={() => tailing() ? stopTailing() : startTailing()}
                onRequestBind={openBindingPicker}
              />
            </div>
            <div
              onMouseDown={onVResizeStart}
              title="drag to resize"
              style={{
                height: "4px",
                cursor: "row-resize",
                background: "var(--rule)",
                "flex-shrink": 0,
                "user-select": "none",
              }}
            ></div>
            <ConversationView
              messages={visibleMessages()}
              loading={loading()}
              sessionName={sessionName()}
              tailing={tailing()}
              chatState={selectedSession() ? chatState(selectedSession()!) : "idle"}
              onToggleTail={() => tailing() ? stopTailing() : startTailing()}
              pane={selectedSession()?.tmux_pane ?? null}
              pendingIds={pendingIds()}
              firstPendingId={firstPendingId()}
            />
            <PendingToolBar
              pending={pendingList()}
              pane={selectedSession()?.tmux_pane ?? null}
            />
            <ModeBar
              pane={selectedSession()?.tmux_pane ?? null}
              sessionId={selectedSession()!.id}
            />
            <Composer
              session={selectedSession()!}
              onSend={(text) => addOptimistic(selectedSession()!.id, text)}
            />
          </Show>
        </div>
      </div>

      <StatusBar
        roomCount={counts().roomCount}
        activeCount={counts().active}
        idleCount={counts().idle}
        waitingCount={counts().waiting}
      />

      <CommandPalette
        open={paletteOpen()}
        commands={commands()}
        onClose={() => setPaletteOpen(false)}
      />

      <ContextMenu
        open={!!ctxMenu()}
        x={ctxMenu()?.x ?? 0}
        y={ctxMenu()?.y ?? 0}
        items={ctxItems()}
        onClose={() => setCtxMenu(null)}
      />

      <RenameDialog
        open={!!renaming()}
        initial={renaming() ? (customNameFor(renaming()!.id) || "") : ""}
        title={renaming() ? (renaming()!.display_name || renaming()!.slug || renaming()!.id) : ""}
        onSave={(name) => {
          const r = renaming();
          if (r) setCustomName(r.id, name);
        }}
        onClose={() => setRenaming(null)}
      />

      <TmuxBindingPicker
        open={!!bindingFor()}
        sessionId={bindingFor()?.id ?? ""}
        sessionCwd={bindingFor()?.cwd ?? null}
        currentPane={bindingFor()?.tmux_pane ?? null}
        onPick={(pane) => {
          const s = bindingFor();
          if (s) setTmuxBinding(s.id, pane);
        }}
        onClose={() => setBindingFor(null)}
      />
    </div>
  ); }
}

export default App;
