import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

// Miniflare passes NODE_EXTRA_CA_CERTS to workerd's TLS trust store. On
// NixOS, workerd's compiled-in CA locations do not find the system bundle.
// Set this before starting the CLI, so Node and Miniflare both pick it up.
const env = { ...process.env };
if (!env.NODE_EXTRA_CA_CERTS) {
  const bundle = [
    env.SSL_CERT_FILE,
    env.NIX_SSL_CERT_FILE,
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/cert.pem",
  ].find((path) => path && existsSync(path));
  if (bundle) env.NODE_EXTRA_CA_CERTS = bundle;
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: bun scripts/with-system-certs.ts <command> [args...]");
  process.exitCode = 1;
} else {
  const child = spawn(command, args, { env, stdio: "inherit" });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
  });
}
