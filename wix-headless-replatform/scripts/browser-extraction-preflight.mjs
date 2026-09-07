#!/usr/bin/env node
import { parseArgs } from "./lib/common.mjs";
import { runBrowserExtractionPreflight } from "./lib/browser-tooling.mjs";

async function main() {
  const args = parseArgs();
  const startDir = args["project-root"] || process.cwd();
  const report = await runBrowserExtractionPreflight({
    startDir,
    fix: Boolean(args.fix),
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`Project root: ${report.context.projectRoot || "not found"}`);
    console.log(`Package manager: ${report.context.packageManager}`);
    for (const check of report.checks) {
      const label = check.status === "pass" ? "PASS" : check.status === "skip" ? "SKIP" : "FAIL";
      console.log(`${label} ${check.id}: ${check.message}`);
    }
    if (report.remediation.commands.length) {
      console.log("");
      console.log("Suggested commands:");
      for (const command of report.remediation.commands) {
        console.log(command);
      }
    }
    for (const note of report.remediation.notes) {
      console.log(note);
    }
  }

  if (!report.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
