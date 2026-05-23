import fs from "node:fs/promises";
import path from "node:path";

export type RecordedResourceCategory = "js" | "css" | "doc" | "image" | "font" | "wasm" | "etc";

export interface RecordingOptions {
  /**
   * Deprecated. Recording now captures every request that reaches the upstream
   * proxy path, including Ajax/XHR/fetch-style requests.
   */
  includeAjax?: boolean;
}

export interface RecordedRequestInput {
  url: string;
  method?: string;
  status?: number;
  requestHeaders?: Record<string, string | string[] | undefined>;
  responseHeaders?: Record<string, string | string[] | undefined>;
}

export interface RecordedRequest {
  url: string;
  category: RecordedResourceCategory;
  method: string;
  status?: number;
  ts: string;
}

export interface RecordingExport {
  startedAt: string;
  endedAt: string;
  includeAjax: boolean;
  total: number;
  categories: Record<RecordedResourceCategory, string[]>;
  requests: RecordedRequest[];
}

export interface RecordingStopResult {
  active: boolean;
  export?: RecordingExport;
  filePath?: string;
  fileName?: string;
}

const categoryOrder: RecordedResourceCategory[] = ["js", "css", "doc", "image", "font", "wasm", "etc"];

export class RequestRecorder {
  private active = false;
  private startedAt = "";
  private includeAjax = true;
  private records: RecordedRequest[] = [];
  private lastFilePath: string | undefined;

  constructor(private readonly outputDir: string) {}

  state(): { active: boolean; startedAt?: string; includeAjax: boolean; count: number; lastFileName?: string } {
    return {
      active: this.active,
      startedAt: this.startedAt || undefined,
      includeAjax: this.includeAjax,
      count: this.records.length,
      lastFileName: this.lastFilePath ? path.basename(this.lastFilePath) : undefined
    };
  }

  start(_options: RecordingOptions = {}): void {
    this.active = true;
    this.startedAt = new Date().toISOString();
    this.includeAjax = true;
    this.records = [];
    this.lastFilePath = undefined;
  }

  record(input: RecordedRequestInput): void {
    if (!this.active) {
      return;
    }

    const url = normalizeUrl(input.url);
    const category = classifyRequest(url, input.requestHeaders, input.responseHeaders);
    this.records.push({
      url,
      category,
      method: input.method ?? "GET",
      status: input.status,
      ts: new Date().toISOString()
    });
  }

  async stop(): Promise<RecordingStopResult> {
    if (!this.active) {
      return {
        active: false,
        filePath: this.lastFilePath,
        fileName: this.lastFilePath ? path.basename(this.lastFilePath) : undefined
      };
    }

    this.active = false;
    const endedAt = new Date().toISOString();
    const recording = this.buildExport(endedAt);
    await fs.mkdir(this.outputDir, { recursive: true });
    this.lastFilePath = path.join(this.outputDir, `${safeTimestamp(recording.startedAt)}.json`);
    await fs.writeFile(this.lastFilePath, `${JSON.stringify(recording, null, 2)}\n`, "utf8");
    return {
      active: false,
      export: recording,
      filePath: this.lastFilePath,
      fileName: path.basename(this.lastFilePath)
    };
  }

  async readLastExport(): Promise<string | undefined> {
    if (!this.lastFilePath) {
      return undefined;
    }
    return fs.readFile(this.lastFilePath, "utf8");
  }

  private buildExport(endedAt: string): RecordingExport {
    const requests = [...this.records].sort(compareRequests);
    const categories: Record<RecordedResourceCategory, string[]> = {
      js: [],
      css: [],
      doc: [],
      image: [],
      font: [],
      wasm: [],
      etc: []
    };
    for (const request of requests) {
      categories[request.category].push(request.url);
    }

    return {
      startedAt: this.startedAt,
      endedAt,
      includeAjax: this.includeAjax,
      total: requests.length,
      categories,
      requests
    };
  }
}

export function classifyRequest(
  url: string,
  requestHeaders?: Record<string, string | string[] | undefined>,
  responseHeaders?: Record<string, string | string[] | undefined>
): RecordedResourceCategory {
  const destination = headerValue(requestHeaders, "sec-fetch-dest").toLowerCase();
  if (destination === "script") return "js";
  if (destination === "style") return "css";
  if (destination === "document" || destination === "iframe") return "doc";
  if (destination === "image") return "image";
  if (destination === "font") return "font";

  const contentType = headerValue(responseHeaders, "content-type").toLowerCase();
  if (contentType.includes("javascript") || contentType.includes("ecmascript")) return "js";
  if (contentType.includes("text/css")) return "css";
  if (contentType.includes("text/html")) return "doc";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.includes("font") || contentType.includes("woff")) return "font";
  if (contentType.includes("application/wasm")) return "wasm";

  const extension = extensionOf(url);
  if ([".js", ".mjs", ".cjs"].includes(extension)) return "js";
  if (extension === ".css") return "css";
  if ([".html", ".htm"].includes(extension)) return "doc";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico", ".bmp"].includes(extension)) {
    return "image";
  }
  if ([".woff", ".woff2", ".ttf", ".otf", ".eot"].includes(extension)) return "font";
  if (extension === ".wasm") return "wasm";
  return "etc";
}

function compareRequests(a: RecordedRequest, b: RecordedRequest): number {
  const categoryDiff = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
  if (categoryDiff !== 0) {
    return categoryDiff;
  }
  return a.url.localeCompare(b.url);
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function extensionOf(value: string): string {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    return path.extname(pathname);
  } catch {
    return path.extname(value.toLowerCase());
  }
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): string {
  if (!headers) {
    return "";
  }
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  if (!found) {
    return "";
  }
  const value = found[1];
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

function safeTimestamp(value: string): string {
  return `recording-${value.replace(/[:.]/g, "-")}`;
}
