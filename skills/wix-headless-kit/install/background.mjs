// The detached jobs setup.mjs and attach.mjs start (through proc.mjs startBackground), run by node
// so they need no shell on any OS. Each leaves the files the caller syncs on:
//
//   node background.mjs install                install.mjs: nothing when node_modules already satisfies
//                                              the lock, npm install when a tree is there, else npm ci
//                                              (falling back to npm install); --ignore-scripts, output
//                                              inherited (the install log); the exit code to .install-exit
//   node background.mjs seed <seed.mjs> <plan>  the seed's stdout to seed-result.json, its stderr to
//                                              seed.log, then its exit code to .seed-exit
import { spawnSync } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { runInstall } from "./install.mjs";

const [job, ...args] = process.argv.slice(2);

if (job === "install") {
  const r = runInstall(process.cwd());
  console.log(`install: ${r.decision}${r.lock ? ` (${r.lock.missing} of ${r.lock.total} lock entries were missing)` : ""}`);
  process.exit(r.status);
} else if (job === "seed") {
  const [seedFile, plan] = args;
  const out = openSync("seed-result.json", "w");
  const err = openSync("seed.log", "w");
  const r = spawnSync(process.execPath, [seedFile, plan], { stdio: ["ignore", out, err], windowsHide: true });
  closeSync(out);
  closeSync(err);
  if (r.error) writeFileSync("seed.log", `the seed could not start: ${r.error.message}\n`, { flag: "a" });
  writeFileSync(".seed-exit", `${r.status ?? 1}\n`);
} else {
  console.error("usage: background.mjs install <ci|install> | seed <seed.mjs> <plan.json>");
  process.exit(2);
}
