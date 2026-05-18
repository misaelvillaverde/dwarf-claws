/**
 * Parse Claude Code's visible permission prompt out of captured tmux pane text.
 *
 * CC renders prompts like:
 *
 *     │ Bash command                                                     │
 *     │ rm -rf "/Applications/Dwarf Claws.app"                           │
 *     │                                                                  │
 *     │ Do you want to proceed?                                          │
 *     │ ❯ 1. Yes                                                         │
 *     │   2. Yes, and don't ask again for `rm` commands in /Applications │
 *     │   3. No, and tell Claude what to do differently (esc)            │
 *
 * The option order is not stable across versions — recent builds may swap
 * "always" and "deny" positions. We classify each visible numbered line by
 * its label and return the key for each semantic intent.
 */

export interface PromptOptions {
  /** Number key for the "Yes / Allow once" option, if visible. */
  allow: string | null;
  /** Number key for the "Yes, and don't ask again / always" option, if visible. */
  always: string | null;
  /** Number key for the "No / Deny / tell Claude" option, if visible. */
  deny: string | null;
  /** All numbered options as parsed (key + label), in original order. */
  raw: Array<{ key: string; label: string }>;
  /** True if at least one numbered option line was found. */
  detected: boolean;
}

const LINE_RE = /^[\s│▌▏▎▍▌▋▊▉█▐▕|]*[>❯▶➜→]?\s*(\d+)[\.\)]\s+(.+?)\s*[│▌▏▎▍▌▋▊▉█▐▕|]?\s*$/;

function classify(label: string): "allow" | "always" | "deny" | null {
  const lo = label.toLowerCase().trim();

  // Deny first — language like "tell Claude what to do differently" is
  // explicit. Also catches "Cancel", literal "No".
  if (
    /\b(no|cancel|deny|reject)\b/.test(lo) ||
    /\btell\s+claude\b/.test(lo) ||
    /\bdiff?erently\b/.test(lo)
  ) {
    return "deny";
  }

  // Always — "don't ask again", "always", "all <X> commands", "session".
  if (
    /don'?t\s+ask\b/.test(lo) ||
    /\balways\b/.test(lo) ||
    /\b(?:for\s+the\s+rest\s+of|during)\s+(?:this|the)\s+(?:session|conversation)\b/.test(lo) ||
    /\ball\s+\S+\s+commands?\b/.test(lo) ||
    /\bnever\s+ask\b/.test(lo)
  ) {
    return "always";
  }

  // Allow — generic "yes", "proceed", "allow".
  if (/\b(yes|proceed|allow|approve|continue|ok)\b/.test(lo)) {
    return "allow";
  }

  return null;
}

export function parsePromptOptions(paneText: string): PromptOptions {
  const lines = paneText.split("\n");
  // Walk from the bottom up — the prompt is near the cursor — stop scanning
  // once we've seen options to avoid picking up unrelated numbered lists.
  const recent = lines.slice(Math.max(0, lines.length - 60));

  const raw: Array<{ key: string; label: string }> = [];
  for (const line of recent) {
    const m = line.match(LINE_RE);
    if (!m) continue;
    const key = m[1];
    if (key.length > 2) continue; // ignore long numbers (line numbers, page refs)
    const label = m[2].trim();
    if (label.length < 2) continue;
    raw.push({ key, label });
  }

  // De-dup by key (later occurrences win — the latest prompt).
  const byKey = new Map<string, string>();
  for (const opt of raw) {
    byKey.set(opt.key, opt.label);
  }
  const consolidated = [...byKey.entries()].map(([key, label]) => ({ key, label }));
  consolidated.sort((a, b) => Number(a.key) - Number(b.key));

  let allow: string | null = null;
  let always: string | null = null;
  let deny: string | null = null;

  for (const opt of consolidated) {
    const kind = classify(opt.label);
    if (kind === "deny" && deny === null) deny = opt.key;
    else if (kind === "always" && always === null) always = opt.key;
    else if (kind === "allow" && allow === null) allow = opt.key;
  }

  return {
    allow,
    always,
    deny,
    raw: consolidated,
    detected: consolidated.length > 0,
  };
}

/**
 * Pick the key to send for a user intent given a parsed prompt. Falls back to
 * the static default (1=allow, 2=always, 3=deny) when the prompt is not parsable.
 */
export function keyForIntent(
  intent: "allow" | "always" | "deny",
  parsed: PromptOptions,
): string {
  const detected = parsed[intent];
  if (detected) return detected;
  // Static fallback — matches the layout we shipped originally.
  if (intent === "allow") return "1";
  if (intent === "always") return "2";
  return "3";
}
