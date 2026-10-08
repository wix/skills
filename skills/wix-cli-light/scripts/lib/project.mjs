// The project on disk as the CLI reads it: `wix.config.json` and `.env.local`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG = "wix.config.json";
export const ENV_FILE = ".env.local";

export function readConfig(dir) {
  const file = join(dir, CONFIG);
  if (!existsSync(file)) throw Object.assign(new Error(`no ${CONFIG} in ${dir}`), { code: "NoProject" });
  const c = JSON.parse(readFileSync(file, "utf8"));
  if (!c.appId || !c.siteId) throw Object.assign(new Error(`${CONFIG} needs appId and siteId`), { code: "NoProject" });
  return { projectType: "Site", ...c };
}

export const writeConfig = (dir, config) => writeFileSync(join(dir, CONFIG), JSON.stringify(config, null, 2) + "\n");

// dotenv's subset: KEY=value, optional export, optional quotes, comments dropped.
export function readEnv(dir) {
  const file = join(dir, ENV_FILE);
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, eq).trim().replace(/^export\s+/, "")] = value;
  }
  return out;
}

/** Merges `variables` over the existing file, `KEY="value"` per line, the CLI's writer's shape. */
export function writeEnv(dir, variables) {
  const merged = { ...readEnv(dir), ...variables };
  writeFileSync(join(dir, ENV_FILE), Object.entries(merged).map(([k, v]) => `${k}="${v}"`).join("\n") + "\n");
  return merged;
}
