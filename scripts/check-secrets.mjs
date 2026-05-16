import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const maxScannedBytes = 1024 * 1024;
const patterns = [
  {
    name: "OpenAI API key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g
  },
  {
    name: "GitHub token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g
  },
  {
    name: "Private key",
    pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/g
  }
];
const findings = [];

for (const file of getTrackedFiles()) {
  const buffer = readFileSync(file);

  if (buffer.length > maxScannedBytes || buffer.includes(0)) {
    continue;
  }

  const source = buffer.toString("utf8");
  for (const { name, pattern } of patterns) {
    let match = pattern.exec(source);

    while (match !== null) {
      findings.push({
        file,
        line: lineNumberForIndex(source, match.index),
        name
      });
      match = pattern.exec(source);
    }
  }
}

if (findings.length > 0) {
  console.error("Tracked-secret check failed:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} contains a possible ${finding.name}.`);
  }
  process.exit(1);
}

console.log("Tracked-secret check passed.");

function getTrackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
}

function lineNumberForIndex(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}
