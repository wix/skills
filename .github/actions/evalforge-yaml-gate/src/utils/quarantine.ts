import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import * as jsYaml from 'js-yaml';
import { z } from 'zod';

export const QUARANTINE_PATH = 'yaml/wix-manage-evals/quarantine.yaml';

const QuarantineSchema = z.object({
  scenarios: z.array(z.object({
    name: z.string().min(1),
    reason: z.string().min(1),
  }).strict()).default([]),
}).strict();

export type QuarantineEntry = { name: string; reason: string };

export function loadQuarantine(workspaceRoot: string): {
  names: Set<string>;
  entries: QuarantineEntry[];
  errors: string[];
} {
  let raw: string;
  try {
    raw = readFileSync(posix.join(workspaceRoot, QUARANTINE_PATH), 'utf8');
  } catch {
    return { names: new Set(), entries: [], errors: [] };
  }

  try {
    const parsed = QuarantineSchema.parse(jsYaml.load(raw));
    return {
      names: new Set(parsed.scenarios.map(e => e.name)),
      entries: parsed.scenarios,
      errors: [],
    };
  } catch (e) {
    return {
      names: new Set(),
      entries: [],
      errors: [`${QUARANTINE_PATH}: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}
