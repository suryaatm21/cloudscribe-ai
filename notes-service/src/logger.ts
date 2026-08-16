import { serviceConfig } from "./config";

/**
 * Supported log levels in ascending verbosity.
 */
type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Determines if the provided log level should be emitted.
 * @param level Requested log level.
 * @returns True when the message should be logged.
 */
function canLog(level: LogLevel): boolean {
  const currentLevel = serviceConfig.logLevel;
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

/**
 * Removes undefined properties to keep log payloads concise.
 * @param payload Arbitrary metadata map.
 * @returns Sanitized payload with defined entries.
 */
function formatPayload(payload?: Record<string, unknown>): Record<string, unknown> {
  if (!payload) {
    return {};
  }
  return Object.entries(payload).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (value === undefined) {
      return acc;
    }
    acc[key] = value;
    return acc;
  }, {});
}

/**
 * Emits a structured log record in JSON form.
 * @param level Severity of the log entry.
 * @param message Human readable message.
 * @param payload Optional metadata for debugging.
 */
function log(level: LogLevel, message: string, payload?: Record<string, unknown>) {
  if (!canLog(level)) {
    return;
  }
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...formatPayload(payload),
  };
  // eslint-disable-next-line no-console
  console[level === "debug" ? "log" : level](JSON.stringify(entry));
}

/**
 * Centralized logger exposing convenience methods per severity.
 */
export const logger = {
  debug: (message: string, payload?: Record<string, unknown>) =>
    log("debug", message, payload),
  info: (message: string, payload?: Record<string, unknown>) =>
    log("info", message, payload),
  warn: (message: string, payload?: Record<string, unknown>) =>
    log("warn", message, payload),
  error: (message: string, payload?: Record<string, unknown>) =>
    log("error", message, payload),
};
