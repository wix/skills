// Record what this project is in its agent instruction files, so a later session — which has
// none of the build conversation and may never open SKILL.md — still knows the Wix site is the
// source of truth and which skill answers which kind of question.
//
//   node <SKILL_ROOT>/install/pin-agents-md.mjs --vertical <name> [--stack astro]
//
// Run from the project root. Kept out of deploy.mjs on purpose: "copy a vertical's files" and
// "record the project's ground rules" are separate concerns with separate reasons to change.
// APPENDS to each file — a template's or the user's own content is never overwritten — and is
// idempotent via the heading sentinel, so re-running fast-path.mjs writes at most once.
// Project facts that live in the repo (site id, app id) are NOT copied here; they would go
// stale against wix.config.json, which is the one place that owns them.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const vertical = flag("vertical");
const stack = flag("stack", "astro");
// "astro" means the Wix-managed flavour (ambient auth), which is worth naming. Any other stack
// is echoed as given rather than mapped, so adding one can't silently mislabel the project.
const frontend = stack === "astro" ? "Wix-managed Astro" : stack.charAt(0).toUpperCase() + stack.slice(1);

const SENTINEL = "## This app — a Wix Headless frontend";
const note = `
${SENTINEL}

A ${frontend} frontend for a live Wix site; \`wix.config.json\` identifies the site. Built on
the **${vertical}** Wix business solution — more can be added to this same app. **The Wix site
owns the content and commerce** — read and write it through the Wix APIs, never hardcode what
it holds.

The Wix skills are installed at \`.agents/skills/\` — read them from that exact path:

- **\`wix-headless-fast\`** — the code already deployed in \`src/\` and how to extend it. Every
  business solution it ships sits under \`references/<solution>/\`: \`INSTRUCTIONS.md\` is that
  solution's playbook, \`seed/\` creates its content. To add one to this app, run from the
  project root:
  \`node .agents/skills/wix-headless-fast/install/deploy.mjs <solution> --stack ${stack}\`
- **\`wix-docs\`** — the Wix API reference. Confirm any endpoint, request shape, field, or enum
  here before writing code against it, frontend or backend. Never infer a contract from
  generated SDK types or \`node_modules\`.
- **\`wix-manage\`** — recipes for managing the live site itself, as opposed to changing this
  codebase. No recipe for the task? Fall back to \`wix-docs\`.
`;

// Both files, independently — a project may have either, both, or neither, and agents differ
// in which one they read.
const pinned = ["AGENTS.md", "CLAUDE.md"].map((name) => {
  const file = join(process.cwd(), name);
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const wrote = !existing.includes(SENTINEL);
  if (wrote) appendFileSync(file, (existing && !existing.endsWith("\n") ? "\n" : "") + note);
  return { file: name, wrote, created: wrote && !existing };
});
console.log(JSON.stringify({ event: "agents_md", pinned }));
