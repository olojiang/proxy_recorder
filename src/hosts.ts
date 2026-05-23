import fs from "node:fs/promises";
import type { ProxyRule } from "./types.js";

const START = "# proxy-recorder:start";
const END = "# proxy-recorder:end";

export async function applyHostsBlock(
  hostsPath: string,
  hostsIp: string,
  rules: ProxyRule[]
): Promise<void> {
  const existing = await readHosts(hostsPath);
  const withoutBlock = removeManagedBlock(existing);
  const entries = rules
    .filter((rule) => rule.enabled && rule.hostsEnabled)
    .sort((a, b) => a.host.localeCompare(b.host))
    .map((rule) => `${hostsIp}\t${rule.host}\t# proxy-recorder:${rule.id}`);

  const next = entries.length
    ? `${withoutBlock.trimEnd()}\n\n${START}\n${entries.join("\n")}\n${END}\n`
    : `${withoutBlock.trimEnd()}\n`;

  await fs.writeFile(hostsPath, next, "utf8");
}

function removeManagedBlock(content: string): string {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === START);
  if (start === -1) {
    return content;
  }
  const end = lines.findIndex((line, index) => index > start && line.trim() === END);
  if (end === -1) {
    return content;
  }
  return [...lines.slice(0, start), ...lines.slice(end + 1)].join("\n");
}

async function readHosts(hostsPath: string): Promise<string> {
  try {
    return await fs.readFile(hostsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}
