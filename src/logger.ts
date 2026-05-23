import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export interface AccessLogEntry {
  ts: string;
  protocol: "http" | "https" | "connect";
  method: string;
  host: string;
  path: string;
  target?: string;
  ruleId?: string;
  routeMode?: string;
  mountPath?: string;
  upstreamHost?: string;
  referer?: string;
  responseContentType?: string;
  bodyRewritten?: boolean;
  status: number;
  durationMs: number;
  error?: string;
}

export function accessLog(entry: Omit<AccessLogEntry, "ts">): void {
  const payload: AccessLogEntry = {
    ts: new Date().toISOString(),
    ...entry
  };
  const line = JSON.stringify(payload);
  console.log(line);
  void appendLine(line);
}

export async function readRecentLogs(limit = 200): Promise<AccessLogEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(config.logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return raw
    .trim()
    .split("\n")
    .slice(-limit)
    .map((line) => JSON.parse(line) as AccessLogEntry)
    .reverse();
}

async function appendLine(line: string): Promise<void> {
  await fs.mkdir(path.dirname(config.logPath), { recursive: true });
  await fs.appendFile(config.logPath, `${line}\n`, "utf8");
}
