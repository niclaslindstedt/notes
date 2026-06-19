// Small in-app logger shared by the storage layer. Every call pushes an
// entry into a bounded in-memory ring buffer so a future Logs surface (or a
// bug report) can read recent diagnostics back; `subscribeToLogs` lets such
// a surface re-render live. Adapted from checklist's logger, pared to the
// ring buffer the storage backends actually need — notes has no Logs
// settings tab yet, so the localStorage capture mirror is left out.
//
// Deliberately writes to NO console sink by default — the local-first app
// runs in a browser tab where the user can't always reach devtools (notably
// on mobile). Diagnostics flow through the in-memory buffer instead.
//
//   import { createLogger } from "../dev/logger.ts";
//   const log = createLogger("storage");
//   log.info("load start");
//   log.warn("nearing quota");
//   log.error("save failed", err);

const MAX_LOG_ENTRIES = 500;

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  ts: number;
  level: LogLevel;
  scope: string;
  message: string;
};

export type Logger = {
  // Verbose, per-operation tracing. Captured only when debug logging is
  // switched on (Settings → General → Diagnostics) so normal use doesn't fill
  // the ring buffer with noise. info / warn / error are always captured.
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

const DEBUG_KEY = "notes:debug-logs";

const buffer: LogEntry[] = [];
const subscribers = new Set<() => void>();

let debugEnabled = (() => {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(DEBUG_KEY) === "1"
    );
  } catch {
    return false;
  }
})();

/** Whether verbose `debug`-level capture is currently on. */
export function isDebugLogging(): boolean {
  return debugEnabled;
}

/** Turn verbose `debug`-level capture on or off (persisted per device). */
export function setDebugLogging(on: boolean): void {
  debugEnabled = on;
  try {
    localStorage.setItem(DEBUG_KEY, on ? "1" : "0");
  } catch {
    // localStorage unavailable (private mode quota) — the in-memory flag still
    // takes effect for this session.
  }
  notify();
}

// Render an Error for the log buffer. Leads with `name: message` and appends
// the stack when available — some engines (Safari/iOS) format `err.stack` as
// bare frames with no leading message line, so naively falling back to
// `err.stack` would swallow the message.
function describeError(err: Error): string {
  const head = err.message ? `${err.name}: ${err.message}` : err.name;
  if (!err.stack) return head;
  return err.stack.startsWith(err.name) ? err.stack : `${head}\n${err.stack}`;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_key, v: unknown) => {
        if (v instanceof Error) return describeError(v);
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return "[Circular]";
          seen.add(v);
        }
        if (typeof v === "bigint") return v.toString();
        if (typeof v === "function") return "[function]";
        return v;
      }) ?? "undefined"
    );
  } catch {
    return String(value);
  }
}

function formatMessage(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return describeError(a);
      return safeStringify(a);
    })
    .join(" ");
}

function notify(): void {
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      // Subscriber errors must not break the logger.
    }
  }
}

// Cached immutable view of the buffer. `getLogs` must return a stable
// reference between mutations or `useSyncExternalStore` re-renders forever;
// every buffer change invalidates it so the next read rebuilds it once.
let snapshot: LogEntry[] = [];
let snapshotDirty = true;

function invalidate(): void {
  snapshotDirty = true;
}

function push(level: LogLevel, scope: string, args: unknown[]): void {
  buffer.push({ ts: Date.now(), level, scope, message: formatMessage(args) });
  if (buffer.length > MAX_LOG_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_LOG_ENTRIES);
  }
  invalidate();
  notify();
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...args) => {
      if (debugEnabled) push("debug", scope, args);
    },
    info: (...args) => push("info", scope, args),
    warn: (...args) => push("warn", scope, args),
    error: (...args) => push("error", scope, args),
  };
}

export function getLogs(): LogEntry[] {
  if (snapshotDirty) {
    snapshot = buffer.slice();
    snapshotDirty = false;
  }
  return snapshot;
}

/** Drop every captured entry. Backs the Diagnostics "Clear" action. */
export function clearLogs(): void {
  buffer.length = 0;
  invalidate();
  notify();
}

/** Render the captured log as plain text for copying into a bug report. */
export function formatLogs(): string {
  return buffer
    .map(
      (e) =>
        `${new Date(e.ts).toISOString()} [${e.level}] ${e.scope}: ${e.message}`,
    )
    .join("\n");
}

export function subscribeToLogs(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
