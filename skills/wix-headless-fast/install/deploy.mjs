// Deploy the shipped code into the project. Run from the PROJECT ROOT:
//
//   node <SKILL_ROOT>/install/deploy.mjs <vertical> [<vertical> …] --stack astro|react [--client-id <id>]
//
//   --stack astro  (default) — copies each vertical's framework-agnostic core (app/) AND its
//                  Astro overlay (app-astro/: pages, layouts) into src/. Ambient auth: no
//                  client id is needed or written.
//   --stack react  — copies only the core (app/) into src/, and writes the public OAuth
//                  client id into src/wix/config.ts (pass --client-id, or it's read from
//                  wix.config.json's appId when present).
//
// ONE mechanism: recursive copy with force:false — only files that AREN'T there yet are
// written, so a re-run restores missing files without clobbering edits, and a later call can
// add a vertical safely. Verticals ship at disjoint paths (src/wix/<vertical>/,
// src/components/<vertical>/, …), so they never collide with each other.
import { cpSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(SKILL_ROOT, "references");
const PROJECT = process.cwd();
const SRC = join(PROJECT, "src");
const CONFIG_TS = join(SRC, "wix", "config.ts");

// The vertical registry: every directory under references/ that ships an app/ is a vertical.
const VERTICALS = readdirSync(REF, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(REF, d.name, "app")) && d.name !== "shared")
  .map((d) => d.name);

const COPY = { recursive: true, force: false, errorOnExist: false };

// ---- args ---------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
const stack = flag("stack") ?? "astro";
const clientIdFlag = flag("client-id");
const flagArgs = new Set(["--stack", "--client-id", stack, clientIdFlag].filter(Boolean));
const requested = [...new Set(argv.filter((a) => !flagArgs.has(a)))];

const result = { stack, verticals: [], skillRoot: SKILL_ROOT };

if (!["astro", "react"].includes(stack)) {
  console.log(JSON.stringify({ error: `unknown --stack "${stack}" — expected astro|react` }));
  process.exit(1);
}

// ---- copy ---------------------------------------------------------------------------------------
// Shared core — always.
cpSync(join(REF, "shared", "app"), SRC, COPY);

const unknown = requested.filter((v) => !VERTICALS.includes(v));
for (const vertical of requested.filter((v) => VERTICALS.includes(v))) {
  cpSync(join(REF, vertical, "app"), SRC, COPY);
  if (stack === "astro" && existsSync(join(REF, vertical, "app-astro"))) {
    cpSync(join(REF, vertical, "app-astro"), SRC, COPY);
  }
  result.verticals.push(vertical);
}

if (unknown.length) {
  result.error = `unknown vertical(s) ${unknown.map((v) => `"${v}"`).join(", ")} — available: ${VERTICALS.join(", ")}`;
}
if (!requested.length) {
  result.note = `no vertical given — deployed the shared core only. Available: ${VERTICALS.join(", ")}`;
}

// ---- client id (react stack only) ---------------------------------------------------------------
// On astro the ambient integration authenticates — WIX_CLIENT_ID stays null.
if (stack === "react") {
  let clientId = clientIdFlag;
  if (!clientId && existsSync(join(PROJECT, "wix.config.json"))) {
    // On a Wix-managed project the public OAuth client id IS the appId.
    clientId = JSON.parse(readFileSync(join(PROJECT, "wix.config.json"), "utf8")).appId ?? null;
  }
  if (clientId) {
    const current = readFileSync(CONFIG_TS, "utf8");
    // A non-null id already set wins; only fill the shipped null placeholder.
    if (/WIX_CLIENT_ID:\s*string\s*\|\s*null\s*=\s*null/.test(current)) {
      writeFileSync(CONFIG_TS, current.replace(/WIX_CLIENT_ID:\s*string\s*\|\s*null\s*=\s*null/, `WIX_CLIENT_ID: string | null = "${clientId}"`));
      result.clientId = "written";
    } else {
      result.clientId = "already_set";
    }
  } else {
    result.clientId = "missing — pass --client-id (react stack needs the public OAuth client id)";
  }
}

console.log(JSON.stringify(result, null, 2));
