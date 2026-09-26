// The agent config files `wix create` writes into a new project — AGENTS.md, CLAUDE.md (an import
// of it), .gemini/settings.json — reproduced here word for word. `@wix/create-new` generates them
// only when @wix/cli can be resolved from the project's node_modules at scaffold time; fast-path
// scaffolds with --skip-install (the install runs detached, later), so the CLI's generator fails
// inside a silent catch and writes nothing. Until the CLI writes them regardless of node_modules,
// fast-path and attach write the same files. Fill-only: a file that exists is left alone.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const AGENTS_MD = `## CLI Commands

All CLI instructions can be found at:
node_modules/@wix/cli/agents/instructions.md

## Skills

This project comes with a set of skills that can be used when the user asks for help with specific tasks.
If you're using the instructions provided by a skill and fail, or if you do not find a relevant skill for the task,
you can try updating the skills by running the following command:

\`wix skills update\`

This will update the skills to the latest version.
`;

export function writeCliAgentsMd(projectDir) {
  const written = [];
  const agents = join(projectDir, "AGENTS.md");
  if (!existsSync(agents)) { writeFileSync(agents, AGENTS_MD); written.push("AGENTS.md"); }
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
