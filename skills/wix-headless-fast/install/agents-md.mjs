// The agent config files a new project carries — AGENTS.md, CLAUDE.md (an import of it),
// .gemini/settings.json. `wix create` writes its own set only when @wix/cli resolves from the
// project's node_modules at scaffold time; fast-path scaffolds with --skip-install (the install
// runs detached, later), so the CLI's generator fails inside a silent catch and writes nothing,
// and attach never runs the CLI scaffold at all. Ours keeps the CLI's shape (the CLI commands
// pointer) and says what the CLI's cannot: which skills this project carries, where, how to get
// them back, and the one rule about Wix calls. Fill-only: a file that exists is left alone.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const agentsMd = ({ skill, stack }) => `## CLI Commands

All CLI instructions can be found at:
node_modules/@wix/cli/agents/instructions.md

## This app

A Wix Headless app built on the live Wix site named in \`wix.config.json\`. The site owns the
content and commerce.

**No Wix endpoint, body or field from memory.** Every Wix call comes from the skills below or the
code they deployed.

## Skills

Installed at \`.agents/skills/\`. If missing, restore with:
\`CI=1 npx skills@latest add wix/skills --skill ${skill} --skill wix-docs --skill wix-manage --yes\`

- \`${skill}\` — the code in this app and how to extend it. Each business solution has a playbook at
  \`references/<solution>/INSTRUCTIONS.md\`; \`node .agents/skills/${skill}/install/deploy.mjs <solution> --stack ${stack}\`
  adds one.
- \`wix-docs\` — the Wix API reference, by search.
- \`wix-manage\` — recipes for the live site itself (content, prices, settings), run from the shell
  with \`npx -y @wix/cli@latest token --site <siteId>\`; the token never lands in a file or in
  client code.
`;

export function writeAgentsMd(projectDir, { skill, stack }) {
  const written = [];
  const agents = join(projectDir, "AGENTS.md");
  if (!existsSync(agents)) { writeFileSync(agents, agentsMd({ skill, stack })); written.push("AGENTS.md"); }
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
