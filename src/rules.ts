import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ProxyRule, RuleInput } from "./types.js";

const HOST_LABEL_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

interface NormalizedRuleInput {
  host: string;
  target: string;
  mountPath?: string;
  virtualHost?: string;
  enabled: boolean;
  hostsEnabled: boolean;
}

export class RuleStore {
  private readonly filePath: string;
  private rules: ProxyRule[] | null = null;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "rules.json");
  }

  async list(): Promise<ProxyRule[]> {
    await this.load();
    return [...this.rules!].sort((a, b) => a.host.localeCompare(b.host));
  }

  async get(id: string): Promise<ProxyRule | undefined> {
    await this.load();
    return this.rules!.find((rule) => rule.id === id);
  }

  async findEnabledByHost(host: string): Promise<ProxyRule | undefined> {
    await this.load();
    const normalized = normalizeHost(host);
    return this.rules!.find(
      (rule) => rule.enabled && !rule.mountPath && normalizeHost(rule.host) === normalized
    );
  }

  async findEnabledByRequest(host: string, requestPath: string): Promise<ProxyRule | undefined> {
    await this.load();
    const normalized = normalizeHost(host);
    const matches = this.rules!.filter(
      (rule) => rule.enabled && normalizeHost(rule.host) === normalized
    );
    const pathMatches = matches
      .filter((rule) => rule.mountPath && pathStartsWithMount(requestPath, rule.mountPath))
      .sort((a, b) => b.mountPath!.length - a.mountPath!.length);

    return (
      pathMatches[0] ??
      matches.find((rule) => !rule.mountPath) ??
      matches
        .filter((rule) => rule.mountPath)
        .sort((a, b) => b.mountPath!.length - a.mountPath!.length)[0]
    );
  }

  async create(input: RuleInput): Promise<ProxyRule> {
    await this.load();
    const normalized = normalizeInput(input);
    if (this.rules!.some((rule) => hasSameRoute(rule, normalized))) {
      throw new HttpError(409, `Route already exists: ${routeLabel(normalized)}`);
    }

    const now = new Date().toISOString();
    const rule: ProxyRule = {
      id: crypto.randomUUID(),
      host: normalized.host,
      target: normalized.target,
      mountPath: normalized.mountPath,
      virtualHost: normalized.virtualHost,
      enabled: normalized.enabled,
      hostsEnabled: normalized.hostsEnabled,
      createdAt: now,
      updatedAt: now
    };
    this.rules!.push(rule);
    await this.save();
    return rule;
  }

  async update(id: string, input: RuleInput): Promise<ProxyRule> {
    await this.load();
    const index = this.rules!.findIndex((rule) => rule.id === id);
    if (index === -1) {
      throw new HttpError(404, "Rule not found");
    }

    const normalized = normalizeInput(input);
    const duplicate = this.rules!.find((rule) => rule.id !== id && hasSameRoute(rule, normalized));
    if (duplicate) {
      throw new HttpError(409, `Route already exists: ${routeLabel(normalized)}`);
    }

    const next: ProxyRule = {
      ...this.rules![index],
      host: normalized.host,
      target: normalized.target,
      mountPath: normalized.mountPath,
      virtualHost: normalized.virtualHost,
      enabled: normalized.enabled,
      hostsEnabled: normalized.hostsEnabled,
      updatedAt: new Date().toISOString()
    };
    this.rules![index] = next;
    await this.save();
    return next;
  }

  async delete(id: string): Promise<void> {
    await this.load();
    const before = this.rules!.length;
    this.rules = this.rules!.filter((rule) => rule.id !== id);
    if (this.rules.length === before) {
      throw new HttpError(404, "Rule not found");
    }
    await this.save();
  }

  private async load(): Promise<void> {
    if (this.rules) {
      return;
    }

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as ProxyRule[];
      this.rules = parsed.map((rule) => ({
        ...rule,
        host: normalizeHost(rule.host),
        mountPath: normalizeMountPath(rule.mountPath),
        virtualHost: normalizeOptionalHost(rule.virtualHost)
      }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      this.rules = [];
      await this.save();
    }
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload = JSON.stringify(this.rules ?? [], null, 2);
    await fs.writeFile(this.filePath, `${payload}\n`, "utf8");
  }
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "").split(":")[0] ?? "";
}

function normalizeInput(input: RuleInput): NormalizedRuleInput {
  const host = normalizeHost(input.host);
  if (!isValidHost(host)) {
    throw new HttpError(400, "Invalid host");
  }

  const target = normalizeTarget(input.target);
  return {
    host,
    target,
    mountPath: normalizeMountPath(input.mountPath),
    virtualHost: normalizeOptionalHost(input.virtualHost),
    enabled: input.enabled ?? true,
    hostsEnabled: input.hostsEnabled ?? true
  };
}

function normalizeTarget(target: string): string {
  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(target)
    ? target
    : `https://${target}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new HttpError(400, "Invalid target URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "Target must use http or https");
  }
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function normalizeMountPath(mountPath: string | undefined): string | undefined {
  const trimmed = mountPath?.trim();
  if (!trimmed) {
    return undefined;
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function normalizeOptionalHost(host: string | undefined): string | undefined {
  const normalized = normalizeHost(host ?? "");
  if (!normalized) {
    return undefined;
  }
  if (!isValidHost(normalized)) {
    throw new HttpError(400, "Invalid virtual host");
  }
  return normalized;
}

function isValidHost(host: string): boolean {
  return (
    host.length > 0 &&
    host.length <= 253 &&
    host.split(".").every((label) => HOST_LABEL_RE.test(label))
  );
}

function pathStartsWithMount(requestPath: string, mountPath: string): boolean {
  const mount = mountPath.endsWith("/") ? mountPath : `${mountPath}/`;
  return requestPath === mount.slice(0, -1) || requestPath.startsWith(mount);
}

function hasSameRoute(rule: ProxyRule, normalized: NormalizedRuleInput): boolean {
  return normalizeHost(rule.host) === normalized.host && rule.mountPath === normalized.mountPath;
}

function routeLabel(input: Pick<NormalizedRuleInput, "host" | "mountPath">): string {
  return input.mountPath ? `${input.host}${input.mountPath}` : input.host;
}
