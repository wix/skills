import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@actions/core";
import { load } from "js-yaml";
import { getErrorMessage, ErrorMessage } from "./reporting";
import type { ChangedFile } from "./reporting";

type RawScenario = { tags?: unknown } | null;

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((t) => typeof t === "string")
  );
}

export function changedScenarioFiles(
  files: ChangedFile[],
  scenariosDir: string,
): ChangedFile[] {
  const dir = scenariosDir.replace(/\/+$/, "");
  const scenarios = files.filter(
    (f) =>
      f.status !== "removed" &&
      f.filename.startsWith(`${dir}/`) &&
      /\.ya?ml$/.test(f.filename),
  );

  if (scenarios.length === 0) {
    core.info("No scenario changes — skipping");
  } else {
    core.info(
      `Changed scenarios: ${scenarios.map((f) => f.filename).join(", ")}`,
    );
  }

  return scenarios;
}

export function collectScenarioTags(
  scenarioFiles: ChangedFile[],
  workspaceRoot: string,
): string[] {
  const tags = new Set<string>();

  for (const file of scenarioFiles) {
    let raw: RawScenario;
    try {
      raw = load(
        readFileSync(join(workspaceRoot, file.filename), "utf-8"),
      ) as RawScenario;
    } catch (e) {
      throw new Error(
        `${file.filename}: ${ErrorMessage.YamlParseFailed}: ${getErrorMessage(e)}`,
      );
    }

    const scenarioTags = raw?.tags;
    if (!isNonEmptyStringArray(scenarioTags)) {
      throw new Error(`${file.filename}: ${ErrorMessage.MissingTags}`);
    }

    for (const tag of scenarioTags) tags.add(tag);
  }

  return [...tags];
}
