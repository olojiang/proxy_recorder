import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function resolveTsxBin(cwd = process.cwd(), platform = process.platform) {
  return path.join(cwd, "node_modules", ".bin", platform === "win32" ? "tsx.cmd" : "tsx");
}

export function createDevEnv(sourceEnv = process.env) {
  return {
    ...sourceEnv,
    PROXY_PORT: sourceEnv.PROXY_PORT || "3333"
  };
}

export function startDev() {
  const tsxBin = resolveTsxBin();
  const child = spawn(tsxBin, ["watch", "src/server.ts"], {
    env: createDevEnv(),
    stdio: "inherit"
  });

  child.on("error", (error) => {
    console.error(`Failed to start tsx from ${tsxBin}: ${error.message}`);
    console.error("Run npm install before npm run dev.");
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 0);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  return child;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startDev();
}
