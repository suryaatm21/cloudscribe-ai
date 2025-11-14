import { serviceConfig } from "./config";

type LogLevel = "debug" | "info" | "warn" | "error";

interface ILoggerContext {
  jobId?: string;
  component?: string;
  [key: string]: unknown;
}

function emitLog(level: LogLevel, message: string, context?: ILoggerContext): void {
  const logPayload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    service: serviceConfig.serviceName ?? "video-processing-service",
    environment: serviceConfig.environment,
    ...context,
  };

  if (level === "error") {
    console.error(JSON.stringify(logPayload));
    return;
  }

  if (level === "warn") {
    console.warn(JSON.stringify(logPayload));
    return;
  }

  console.log(JSON.stringify(logPayload));
}

export const logger = {
  debug: (message: string, context?: ILoggerContext) =>
    emitLog("debug", message, context),
  info: (message: string, context?: ILoggerContext) => emitLog("info", message, context),
  warn: (message: string, context?: ILoggerContext) => emitLog("warn", message, context),
  error: (message: string, context?: ILoggerContext) =>
    emitLog("error", message, context),
};

export type { ILoggerContext };

