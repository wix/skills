import type { LoadedScenario } from './evals';
import type { ChangedFile } from './github';
import { normalizeUrl, isUrlShaped } from './url-normalize';
import { AREA_RE, EVALS_AREA_RE } from './paths';
import { isToolCall } from './schema';

export type { ChangedFile };
export type Uncovered = { file: string; canonicalUrl: string; area: string };
export type CoverageResult = {
  coveredBy: Map<string, string[]>;
  uncovered: Uncovered[];
};

function areaOfDoc(filePath: string): string | null {
  const match = filePath.match(AREA_RE);
  return match ? match[1] : null;
}

function areaOfEval(filePath: string): string | null {
  const match = filePath.match(EVALS_AREA_RE);
  return match ? match[1] : null;
}

type ParamMap = Record<string, string | number | boolean | (string | number | boolean)[]>;

function stringValuesIn(params: ParamMap | undefined): string[] {
  if (!params) return [];
  const out: string[] = [];
  for (const v of Object.values(params)) {
    if (Array.isArray(v)) {
      for (const item of v) if (typeof item === 'string') out.push(item);
    } else if (typeof v === 'string') {
      out.push(v);
    }
  }
  return out;
}

export function computeCoverage(
  changedFiles: ChangedFile[],
  scenarios: Map<string, LoadedScenario>,
  canonicalUrlOf: (file: string) => string | null,
): CoverageResult {
  const coveredBy = new Map<string, string[]>();
  const uncovered: Uncovered[] = [];

  const scenariosByArea = new Map<string, { name: string; urls: Set<string> }[]>();
  for (const [name, ls] of scenarios) {
    const area = areaOfEval(ls.path);
    if (!area) continue;
    const urls = new Set<string>();
    for (const a of ls.scenario.assertions) {
      // Only tool-call assertions contribute coverage. LLM-judge assertions carry a prompt string,
      // which may incidentally contain URLs but doesn't represent doc coverage.
      if (!isToolCall(a)) continue;
      for (const v of stringValuesIn(a.params as ParamMap | undefined)) {
        if (isUrlShaped(v)) urls.add(normalizeUrl(v));
      }
    }
    if (!scenariosByArea.has(area)) scenariosByArea.set(area, []);
    scenariosByArea.get(area)!.push({ name, urls });
  }

  for (const f of changedFiles) {
    if (f.status === 'removed') continue;
    if (!f.filename.endsWith('.md')) continue;
    const area = areaOfDoc(f.filename);
    if (!area) continue;
    const canonical = canonicalUrlOf(f.filename);
    if (!canonical) continue;
    const norm = normalizeUrl(canonical);
    const inArea = scenariosByArea.get(area) ?? [];
    const matching = inArea.filter(s => s.urls.has(norm)).map(s => s.name);
    if (matching.length === 0) {
      uncovered.push({ file: f.filename, canonicalUrl: canonical, area });
    } else {
      coveredBy.set(f.filename, matching);
    }
  }

  return { coveredBy, uncovered };
}
