import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const envExamplePath = ".env.example";
const documentedRequiredKeys = [
  "OPENAI_API_KEY",
  "OPENAI_ASK_MODEL",
  "OPENAI_ASK_MAX_OUTPUT_TOKENS",
  "OPENAI_INCLUDE_FULL_SCREENSHOT",
  "OPENAI_CHAT_TITLE_MODEL",
  "OPENAI_REALTIME_MODEL",
  "OPENAI_REALTIME_VOICE",
  "OPENAI_REALTIME_REASONING_EFFORT",
  "OPENAI_REALTIME_TRANSCRIPTION_MODEL",
  "OPENAI_SCREENSHOT_DETAIL",
  "MAUZ_API_PORT",
  "MAUZ_LOCAL_API_TOKEN",
  "MAUZ_API_ALLOW_UNAUTHENTICATED",
  "MAUZ_ENABLE_NATIVE_INPUT",
  "MAUZ_ENABLE_DEV_HOTKEY",
  "MAUZ_INPUT_AGENT_PATH"
];
const intentionallyUndocumentedEnvKeys = new Set([
  "ELECTRON_RENDERER_URL",
  "GH_TOKEN",
  "GITHUB_REPOSITORY",
  "GITHUB_TOKEN",
  "MAUZAI_APP_OUTPUT",
  "PROTECTED_BRANCH"
]);
const sourceFilePattern = /\.(?:cjs|mjs|js|jsx|ts|tsx)$/;
const secretKeyPattern =
  /(?:^|_)(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY)(?:$|_)/;

const problems = [];
const envExample = readFileSync(envExamplePath, "utf8");
const documentedEnvKeys = parseEnvExample(envExample);

for (const key of documentedRequiredKeys) {
  if (!documentedEnvKeys.has(key)) {
    problems.push(`${envExamplePath} is missing ${key}.`);
  }
}

for (const [key, value] of documentedEnvKeys) {
  if (secretKeyPattern.test(key) && value.trim().length > 0) {
    problems.push(`${envExamplePath} must not contain a value for secret-like key ${key}.`);
  }
}

for (const file of getTrackedFiles().filter((path) => sourceFilePattern.test(path) && existsSync(path))) {
  const source = readFileSync(file, "utf8");

  for (const key of findProcessEnvKeys(source)) {
    if (!documentedEnvKeys.has(key) && !intentionallyUndocumentedEnvKeys.has(key)) {
      problems.push(`${file} references undocumented environment variable ${key}.`);
    }
  }
}

if (problems.length > 0) {
  console.error("Environment check failed:");
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  process.exit(1);
}

console.log(`Environment check passed: ${documentedEnvKeys.size} keys documented.`);

function parseEnvExample(source) {
  const keys = new Map();

  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match === null) {
      problems.push(`${envExamplePath}:${index + 1} is not KEY=value format.`);
      continue;
    }

    const [, key, value] = match;
    if (keys.has(key)) {
      problems.push(`${envExamplePath}:${index + 1} duplicates ${key}.`);
      continue;
    }

    keys.set(key, value);
  }

  return keys;
}

function findProcessEnvKeys(source) {
  const keys = new Set();
  const dotPattern = /process\.env\.([A-Z][A-Z0-9_]*)/g;
  const bracketPattern = /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g;

  for (const pattern of [dotPattern, bracketPattern]) {
    let match = pattern.exec(source);
    while (match !== null) {
      keys.add(match[1]);
      match = pattern.exec(source);
    }
  }

  return keys;
}

function getTrackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
}
