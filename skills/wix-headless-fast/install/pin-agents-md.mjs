// Record what this project is in its agent instruction files, so a later session — which has
// none of the build conversation and may never open SKILL.md — knows the Wix site is the source
// of truth, what was deployed, how to release, where the skills are, and which skill answers
// which kind of question.
//
//   node <SKILL_ROOT>/install/pin-agents-md.mjs --vertical <name>[,<name>…] [--stack astro]
//
// Run from the project root. Kept out of deploy.mjs's copy logic on purpose: "copy a solution's
// files" and "record the project's ground rules" are separate concerns; deploy.mjs calls this at
// the end so adding a solution updates the record. The block sits between two HTML-comment
// markers and is REWRITTEN in place on every run (solutions accumulate); everything outside the
// markers — a template's or the user's own content — is never touched. Project facts that live
// in the repo (site id, app id) are NOT copied here; wix.config.json owns them.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const stack = flag("stack", "astro");
const newVerticals = argv.flatMap((a, i) => (a === "--vertical" && argv[i + 1] ? argv[i + 1].split(",") : [])).map((v) => v.trim()).filter(Boolean);
const cwd = process.cwd();

// Where the skills are, relative to this project. The entry installs them in the folder the
// run started in; fast-path and attach put the project in a subfolder of it, so the skills are
// usually one level up. A later session opened in the project has to be told.
const skillsDir = dirname(SKILL_ROOT);
let skillsRel = relative(cwd, skillsDir) || ".";
if (!skillsRel.startsWith(".")) skillsRel = `./${skillsRel}`;
const outside = skillsRel.startsWith("..");
const skillsFrom = outside ? resolve(cwd, skillsRel, "..", "..") : cwd;

const BEGIN = "<!-- wix-headless-fast:begin -->";
const END = "<!-- wix-headless-fast:end -->";
const LEGACY = "## This app — a Wix Headless frontend";

const RELEASE = {
  astro: "`npx @wix/cli@latest build && npx @wix/cli@latest release` (Wix-managed hosting; the release output prints the live URL)",
  static: "`npx @wix/cli@latest release` — uploads the folder `wix.config.json` names in `site.outputDirectory`; no build",
  react: "`npm run build`, then the host of your choice (add its https origin to the OAuth app's allowed domains before a Wix-hosted flow such as checkout can return) — or `npx @wix/cli@latest release` when Wix hosts the build output",
  lib: "`npm run build`, then the host of your choice (add its https origin to the OAuth app's allowed domains)",
};
const FRONTEND = { astro: "Wix-managed Astro", react: "React", lib: "JavaScript (framework-free stores)", static: "static (no bundler)" };

let wiredPaths = "`src/wix/**` (data layer and stores) and `src/hooks/**`, plus the shipped components each solution's INSTRUCTIONS names under `src/components/<solution>/`";
if (stack === "static") {
  let out = ".";
  try { out = JSON.parse(readFileSync(join(cwd, "wix.config.json"), "utf8")).site?.outputDirectory ?? "."; } catch { /* keep */ }
  wiredPaths = `\`${out.replace(/\/$/, "")}/js/wix/**\` (the REST layer and the stores, stripped to browser ESM; the \`.ts\` beside each \`.js\` is the same file with types, for reading)`;
}
if (stack === "lib") wiredPaths = "`src/wix/**` (data layer and framework-free stores)";

const build = (verticals) => {
  const plan = existsSync(join(cwd, "plan.json")) ? "`plan.json` (the seed plan this app's content was created from)" : "none — the content was already on the site, or was supplied";
  const playbooks = verticals.map((v) => `\`${skillsRel}/wix-headless-fast/references/${v}/INSTRUCTIONS.md\``).join(", ");
  return `${BEGIN}
## This app — a Wix Headless frontend

A ${FRONTEND[stack] ?? stack} frontend for a live Wix site. \`wix.config.json\` identifies the site
(\`siteId\`; its dashboard is \`https://manage.wix.com/dashboard/<siteId>\`). **The Wix site owns the
content and commerce** — read and write it through the Wix APIs, never hardcode what it holds.

### State

- Stack: ${stack}
- Business solutions deployed: ${verticals.join(", ")}
- Plan: ${plan}
- Release: ${RELEASE[stack] ?? RELEASE.react}
- Playbooks: ${playbooks}
- Skills: \`${skillsRel}/\`${outside ? " — one level above this project, in the folder the build started in" : ""}.
  If they are missing, reinstall from \`${relative(cwd, skillsFrom) || "."}\`:
  \`CI=1 npx skills@latest add wix/skills --skill wix-headless-fast --skill wix-docs --skill wix-manage --yes\`

### Wired as-is

${wiredPaths} are the shipped integration, tested against live sites. Extend by adding files
beside them; never rewrite their internals, re-route them through API routes, or re-derive a
request shape. A new Wix operation the visitor may perform is a new data-layer function next to
the shipped ones; a privileged one belongs in a validated server endpoint — read
\`${skillsRel}/wix-headless-fast/references/shared/CUSTOM_OPERATIONS.md\` first.

### Tokens

Managing the live site — its content, prices, settings — is a \`wix-manage\` recipe run from the
shell with the CLI's site token: \`npx -y @wix/cli@latest token --site <siteId>\`, sent as the
\`Authorization\` header of that one call. That token is never written to a file, to an env var
the frontend reads, or into client code. The frontend reaches Wix only through its own auth seam
(\`src/wix/sdk.ts\` on a bundled stack; the visitor token in \`js/wix/\` on a static site).

### The skills

- **\`wix-headless-fast\`** — the code deployed here and how to extend it. Every business solution
  it ships sits under \`references/<solution>/\`: \`INSTRUCTIONS.md\` is that solution's playbook,
  \`seed/\` creates its content. To add one to this app, run from the project root:
  \`node ${skillsRel}/wix-headless-fast/install/deploy.mjs <solution> --stack ${stack}\`
- **\`wix-docs\`** — the Wix API reference, used by search (its SKILL.md gives the one \`curl\`).
  Confirm any endpoint, request shape, field, or enum there before writing code against it.
  Never infer a contract from generated SDK types or \`node_modules\`.
- **\`wix-manage\`** — REST recipes for managing the live site itself, as opposed to changing
  this codebase; indexed by solution in its SKILL.md. No recipe for the task? \`wix-docs\`.
${END}
`;
};

const pinned = ["AGENTS.md", "CLAUDE.md"].map((name) => {
  const file = join(cwd, name);
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  let before = existing, after = "", previous = [];
  const b = existing.indexOf(BEGIN), e = existing.indexOf(END);
  if (b !== -1 && e !== -1 && e > b) {
    const block = existing.slice(b, e + END.length);
    previous = (block.match(/^- Business solutions deployed: (.+)$/m)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    before = existing.slice(0, b); after = existing.slice(e + END.length).replace(/^\n/, "");
  } else if (existing.includes(LEGACY)) {
    // the append-once note this script wrote before it kept state: replace it through the end of
    // its section (the next H2, or the end of the file)
    const l = existing.indexOf(LEGACY);
    const next = existing.indexOf("\n## ", l + LEGACY.length);
    before = existing.slice(0, l); after = next === -1 ? "" : existing.slice(next + 1);
  } else if (existing && !existing.endsWith("\n")) {
    before = existing + "\n";
  }
  const verticals = [...new Set([...previous, ...newVerticals])];
  if (!verticals.length) { console.log(JSON.stringify({ event: "agents_md", error: "no --vertical given and none recorded" })); process.exit(1); }
  const content = before + (before && !before.endsWith("\n\n") && before.endsWith("\n") ? "\n" : "") + build(verticals) + (after ? "\n" + after : "");
  const changed = content !== existing;
  if (changed) writeFileSync(file, content);
  return { file: name, wrote: changed, created: changed && !existing, verticals };
});
console.log(JSON.stringify({ event: "agents_md", pinned, skills: skillsRel }));
