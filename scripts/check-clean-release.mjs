import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

run("npm", ["run", "check:forbidden-files"]);
run("npm", ["run", "check:version"]);

const trackedArtifacts = execFileSync("git", ["ls-files", "release"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => /\.(?:zip|dmg|zst)$|\/(?:update\.json|SHA256SUMS\.txt)$/.test(file));
if (trackedArtifacts.length) throw new Error(`tracked release artifacts:\n${trackedArtifacts.join("\n")}`);

if (process.env.CI) {
  const status = execFileSync("git", ["status", "--short"], { encoding: "utf8" }).trim();
  if (status) throw new Error(`release checkout is not clean:\n${status}`);
}

if (process.env.GITHUB_REF_TYPE === "tag") {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const expected = `v${version}`;
  if (process.env.GITHUB_REF_NAME !== expected) {
    throw new Error(`release tag ${process.env.GITHUB_REF_NAME} does not match package version ${expected}`);
  }
}

console.log("clean release checks passed");
