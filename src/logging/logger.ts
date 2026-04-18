export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const SECRET_KEY_PATTERN = /(token|key|secret|password|authorization)/i;
const OMITTED_KEY_PATTERN = /(message|content|text|prompt)/i;

function sanitizeMeta(value: unknown, parentKey?: string): unknown {
  if (parentKey && SECRET_KEY_PATTERN.test(parentKey)) {
    return "[redacted]";
  }

  if (parentKey && OMITTED_KEY_PATTERN.test(parentKey)) {
    return "[omitted]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMeta(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeMeta(entry, key)])
    );
  }

  if (typeof value === "string" && value.length > 200) {
    return `${value.slice(0, 200)}…`;
  }

  return value;
}

export class Logger {
  constructor(private readonly level: LogLevel) {}

  debug(event: string, meta?: Record<string, unknown>): void {
    this.log("debug", event, meta);
  }

  info(event: string, meta?: Record<string, unknown>): void {
    this.log("info", event, meta);
  }

  warn(event: string, meta?: Record<string, unknown>): void {
    this.log("warn", event, meta);
  }

  error(event: string, meta?: Record<string, unknown>): void {
    this.log("error", event, meta);
  }

  private log(level: LogLevel, event: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.level]) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...(meta ? { meta: sanitizeMeta(meta) } : {})
    };

    console.log(JSON.stringify(payload));
  }
}

export function createLogger(level: LogLevel): Logger {
  return new Logger(level);
}
