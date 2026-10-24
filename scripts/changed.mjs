#!/usr/bin/env node
// Which parts of the repo changed since a commit, so CI and deploys run only
// what they need (.github/workflows). Writes web, lambda and infra (true or
// false) to $GITHUB_OUTPUT, or prints them when run by hand:
//
//   node scripts/changed.mjs <since>   # e.g. HEAD^1, a deployed commit
//
// With no commit, or one this checkout doesn't have (a history rewritten),
// everything counts as changed: a run never skips what it can't vouch for.
// What every part builds with (the lockfile, the workflows, these scripts)
// changes them all.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const SHARED = [/^package\.json$/, /^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/, /^\.github\/workflows\//, /^scripts\//];

const PARTS = {
  web: [/^bizzy-web\//],
  lambda: [/^bizzy-lambda\//],
  infra: [/^bizzy-infra\//],
};

function changedFiles(since) {
  if (!since) return undefined;
  try {
    const out = execFileSync("git", ["diff", "--name-only", since, "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").filter(Boolean);
  } catch {
    return undefined;
  }
}

const since = process.argv[2]?.trim();
const files = changedFiles(since);
const touches = (patterns) => files === undefined || files.some((file) => patterns.some((p) => p.test(file)));
const shared = touches(SHARED);
const result = Object.fromEntries(Object.entries(PARTS).map(([part, patterns]) => [part, shared || touches(patterns)]));

console.log(
  files === undefined
    ? `No commit to compare with${since ? ` (${since} isn't here)` : ""}: everything counts as changed.`
    : `${files.length} file(s) changed since ${since}.`,
);
const lines = Object.entries(result).map(([part, changed]) => `${part}=${changed}`);
console.log(lines.join("\n"));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
