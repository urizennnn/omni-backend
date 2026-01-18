#!/usr/bin/env node
/*
 Ensures the repository uses a single package manager (Yarn).
 Blocks commits if other lockfiles are present.
*/

const fs = require("fs");
const path = require("path");

const repoRoot = process.cwd();
const allowed = {
  manager: "yarn",
  lockfile: "yarn.lock",
};

const disallowedLockfiles = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "bun.lockb",
];

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch (e) {
    return false;
  }
}

const hasAllowed = exists(path.join(repoRoot, allowed.lockfile));
const offenders = disallowedLockfiles.filter((f) =>
  exists(path.join(repoRoot, f)),
);

if (!hasAllowed) {
  console.error(
    `\n[enforce-package-manager] Missing required lockfile: ${allowed.lockfile}.`,
  );
  console.error("Please run with Yarn and commit the generated yarn.lock.");
  process.exit(1);
}

if (offenders.length > 0) {
  console.error(
    "\n[enforce-package-manager] Multiple package managers detected.",
  );
  console.error(`Allowed: ${allowed.manager} (${allowed.lockfile})`);
  console.error(
    `Remove these files before committing: ${offenders.join(", ")}`,
  );
  process.exit(1);
}

process.exit(0);
