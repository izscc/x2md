import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const forbidden = tracked.filter((file) => {
  const name = file.split("/").at(-1) || "";
  return ["config.json", "x2md.log", "x2md.pid", ".DS_Store"].includes(name) ||
    /^\.env(?:\.|$)/.test(name) && name !== ".env.example" ||
    /\.(?:pem|key|p12|pfx)$/i.test(name) ||
    /^(?:credentials|secrets?)(?:\.|$)/i.test(name);
});

if (forbidden.length) {
  console.error(`禁止跟踪本机运行文件或 secret：\n${forbidden.map((file) => `- ${file}`).join("\n")}`);
  process.exit(1);
}

console.log(`forbidden-files check passed (${tracked.length} tracked files)`);
