import { createSignal, onCleanup } from "solid-js";

const [now, setNow] = createSignal(Date.now());
let consumers = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
const TICK_MS = 250;

function acquire() {
  consumers++;
  if (consumers === 1) {
    intervalId = setInterval(() => setNow(Date.now()), TICK_MS);
  }
}
function release() {
  consumers--;
  if (consumers === 0 && intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/// Returns a reactive accessor for the current time, ticked every 250ms.
/// Single shared interval across all consumers; auto-released on component cleanup.
export function useSharedClock(): () => number {
  acquire();
  onCleanup(release);
  return now;
}
