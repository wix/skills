// The detached jobs setup.mjs and attach.mjs start (through proc.mjs startBackground), run by node
// so they need no shell on any OS. Each leaves the files the caller syncs on:
//
//   node background.mjs install <ci|install>   npm ci (falling back to npm install) or npm install,
//                                              --ignore-scripts, output inherited (the install log);
//                                              npm itself writes node_modules/.package-lock.json last
//   node background.mjs seed <seed.mjs> <plan>  the seed's stdout to seed-result.json, its stderr to
//                                              seed.log, then its exit code to .seed-exit
import { spawnSync } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { npmSync } from "./proc.mjs";

const [job, ...args] = process.argv.slice(2);

if (job === "install") {
  const flags = ["--ignore-scripts"];
  let r = args[0] === "ci" ? npmSync("npm", ["ci", ...flags], { stdio: "inherit" }) : { status: 1 };
  if (r.status !== 0) r = npmSync("npm", ["install", ...flags], { stdio: "inherit" });
  if (r.error) console.error(`npm could not start: ${r.error.message}`);
  process.exit(r.status ?? 1);
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
