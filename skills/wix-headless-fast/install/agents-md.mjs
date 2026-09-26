// Writes a new project's agent config files — AGENTS.md, CLAUDE.md (an import of it),
// .gemini/settings.json. The AGENTS.md text is the file beside this one, `install/AGENTS.md`,
// with {{SKILL}} (the installed skill folder's name) and {{STACK}} filled in. It keeps the CLI's
// shape (the CLI commands pointer `wix create` writes) and says what the CLI's cannot: which skills
// this project carries, where, how to restore them, and the one rule about Wix calls.
// `wix create` writes its own set only when @wix/cli resolves from the project's node_modules at
// scaffold time; fast-path scaffolds with --skip-install and attach never runs the CLI scaffold,
// so we write them. Fill-only: a file that exists is left alone.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "AGENTS.md");

export function writeAgentsMd(projectDir, vars) {
  const written = [];
  const agents = join(projectDir, "AGENTS.md");
  if (!existsSync(agents)) {
    const text = readFileSync(TEMPLATE, "utf8").replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k.toLowerCase()] ?? "");
    writeFileSync(agents, text); written.push("AGENTS.md");
  }
  const claude = join(projectDir, "CLAUDE.md");
  if (!existsSync(claude)) { writeFileSync(claude, "@AGENTS.md"); written.push("CLAUDE.md"); }
  const gemini = join(projectDir, ".gemini", "settings.json");
  if (!existsSync(gemini)) {
    mkdirSync(join(projectDir, ".gemini"), { recursive: true });
    writeFileSync(gemini, JSON.stringify({ contextFileName: "AGENTS.md" }, null, 2) + "\n");
    written.push(".gemini/settings.json");
  }
  return written;
}
