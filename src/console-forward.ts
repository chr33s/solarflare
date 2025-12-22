/** Forwards browser console logs to the wrangler dev server. */

/** Log levels matching wrangler's --log-level options. */
export type LogLevel = "debug" | "info" | "log" | "warn" | "error" | "none";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  log: 2,
  warn: 3,
  error: 4,
  none: 5,
};

/** Checks if a log level should be shown given the threshold. */
function shouldLog(level: string, threshold: LogLevel): boolean {
  const levelPriority = LOG_LEVEL_PRIORITY[level as LogLevel] ?? LOG_LEVEL_PRIORITY.log;
  const thresholdPriority = LOG_LEVEL_PRIORITY[threshold];
  return levelPriority >= thresholdPriority;
}

/** Log entry from the browser. */
interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
  url?: string;
  stacks?: string[];
  extra?: unknown[];
}

/** Request payload from client. */
interface ClientLogRequest {
  logs: LogEntry[];
}

/** Console forwarding configuration. */
export interface ConsoleForwardOptions {
  enabled?: boolean;
  /** API endpoint path. @default '/_console' */
  endpoint?: string;
  levels?: ("log" | "warn" | "error" | "info" | "debug")[];
  includeStacks?: boolean;
}

const DEFAULT_OPTIONS: Required<ConsoleForwardOptions> = {
  enabled: true,
  endpoint: "/_console",
  levels: ["log", "warn", "error", "info", "debug"],
  includeStacks: true,
};

/** ANSI color codes. */
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

/** Gets ANSI color code for log level. */
function getLevelColor(level: string): string {
  switch (level) {
    case "error":
      return colors.red;
    case "warn":
      return colors.yellow;
    case "info":
      return colors.cyan;
    case "debug":
      return colors.gray;
    default:
      return colors.blue;
  }
}

/** Formats log message for terminal output. */
function formatLogMessage(log: LogEntry): string {
  const color = getLevelColor(log.level);
  const prefix = `${color}[browser:${log.level}]${colors.reset}`;
  let message = `${prefix} ${log.message}`;

  // Add stack traces if available
  if (log.stacks && log.stacks.length > 0) {
    message +=
      "\n" +
      log.stacks
        .map((stack) =>
          stack
            .split("\n")
            .map((line) => `${colors.dim}    ${line}${colors.reset}`)
            .join("\n"),
        )
        .join("\n");
  }

  // Add extra data if available
  if (log.extra && log.extra.length > 0) {
    const extraStr = JSON.stringify(log.extra, null, 2);
    message +=
      "\n" +
      extraStr
        .split("\n")
        .map((line) => `${colors.dim}    ${line}${colors.reset}`)
        .join("\n");
  }

  return message;
}

/** Processes console logs from the client. */
export async function processConsoleLogs(
  request: Request,
  logLevel: LogLevel = "log",
): Promise<Response> {
  try {
    const { logs }: ClientLogRequest = await request.json();

    for (const log of logs) {
      // Filter logs based on the configured log level
      if (shouldLog(log.level, logLevel)) {
        console.log(formatLogMessage(log));
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[browser:error] Failed to process console logs:", error);
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/** Checks if request is a console forward request. */
export function isConsoleRequest(request: Request, options: ConsoleForwardOptions = {}): boolean {
  const { endpoint } = { ...DEFAULT_OPTIONS, ...options };
  const url = new URL(request.url);
  return url.pathname === endpoint && request.method === "POST";
}

/** Generates client-side script that patches console methods. */
export function generateClientScript(options: ConsoleForwardOptions = {}): string {
  const { endpoint, levels, includeStacks } = { ...DEFAULT_OPTIONS, ...options };

  return /* js */ `
(function() {
  const originalMethods = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };

  const logBuffer = [];
  let flushTimeout = null;
  const FLUSH_DELAY = 100;
  const MAX_BUFFER_SIZE = 50;

  function createLogEntry(level, args) {
    const stacks = [];
    const extra = [];

    const message = Array.from(args).map((arg) => {
      if (arg === undefined) return "undefined";
      if (arg === null) return "null";
      if (typeof arg === "string") return arg;
      if (typeof arg === "number" || typeof arg === "boolean") return String(arg);

      if (arg instanceof Error || (arg && typeof arg.stack === "string")) {
        let stringifiedError = arg.toString();
        if (${includeStacks} && arg.stack) {
          let stack = arg.stack.toString();
          if (stack.startsWith(stringifiedError)) {
            stack = stack.slice(stringifiedError.length).trimStart();
          }
          if (stack) {
            stacks.push(stack);
          }
        }
        return stringifiedError;
      }

      if (typeof arg === "object") {
        try {
          const serialized = JSON.parse(JSON.stringify(arg));
          extra.push(serialized);
          return "[object]";
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(" ");

    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      stacks,
      extra: extra.length > 0 ? extra : undefined,
    };
  }

  async function sendLogs(logs) {
    const payload = JSON.stringify({ logs });
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon("${endpoint}", blob);
  }

  function flushLogs() {
    if (logBuffer.length === 0) return;
    const logsToSend = [...logBuffer];
    logBuffer.length = 0;
    sendLogs(logsToSend);
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
  }

  function addToBuffer(entry) {
    logBuffer.push(entry);
    if (logBuffer.length >= MAX_BUFFER_SIZE) {
      flushLogs();
      return;
    }
    if (!flushTimeout) {
      flushTimeout = setTimeout(flushLogs, FLUSH_DELAY);
    }
  }

  // Patch console methods
  ${levels
    .map(
      (level) => `
  console.${level} = function(...args) {
    originalMethods.${level}(...args);
    const entry = createLogEntry("${level}", args);
    addToBuffer(entry);
  };`,
    )
    .join("\n")}

  window.addEventListener("beforeunload", flushLogs);
  setInterval(flushLogs, 10000);
})();
`;
}
