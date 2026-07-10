#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ["app/tests/fixtures", "extension/tests/fixtures"];
const allowedExtensions = /\.(?:json|jsonl|md|txt|html)$/i;
const checks = [
  ["Authorization header", /\bauthorization\s*[:=]\s*["']?(?:bearer|basic)\s+[A-Za-z0-9._~+\/-]{8,}/i],
  ["cookie header", /\bcookie\s*[:=]\s*["'][^"'\n]{8,}/i],
  ["ct0 credential", /\bct0\s*[:=]\s*["'][^"'\n]{4,}/i],
  ["token credential", /["']?(?:access_|refresh_|api_)?token["']?\s*[:=]\s*["'][^"'\n]{8,}/i],
  ["personal absolute path", /(?:\/Users\/[^/\s"']+\/|[A-Za-z]:\\Users\\[^\\\s"']+\\)/],
];

function files(dir) {
  try {
    return readdirSync(dir).flatMap((name) => {
      const file = resolve(dir, name);
      return statSync(file).isDirectory() ? files(file) : allowedExtensions.test(name) ? [file] : [];
    });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

const findings = [];
for (const root of roots) {
  for (const file of files(resolve(root))) {
    const content = readFileSync(file, "utf8");
    for (const [label, pattern] of checks) {
      const match = content.match(pattern);
      if (match) findings.push(`${relative(process.cwd(), file)}: ${label}`);
    }
  }
}
if (findings.length) {
  console.error(`Fixture privacy check failed:\n${findings.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}
console.log(`fixture privacy ok (${roots.join(", ")})`);
