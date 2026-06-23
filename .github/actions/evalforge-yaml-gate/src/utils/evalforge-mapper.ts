import {
  isApiCall, isCost, isLlmJudge, isTimeLimit,
  type ApiCallAssertion, type Assertion, type CostAssertion,
  type LlmJudgeAssertion, type Scenario, type SiteBootstrapStep, type SiteSetup,
  type TimeLimitAssertion,
} from './schema';

// EvalForge v1 TestScenario uses assertionLinks (system-assertion references with primitive params)
// rather than inline assertions. params must be Record<string, string | number | boolean | null>.
// See packages/eval-types/src/assertion/assertion.ts in wix-private/evalforge.

const SYSTEM_TOOL_CALL = 'system:tool_called_with_param';
const SYSTEM_LLM_JUDGE = 'system:llm_judge';
const SYSTEM_API_CALL = 'system:api_call';
const SYSTEM_COST = 'system:cost';
const SYSTEM_TIME_LIMIT = 'system:time_limit';

type LinkParams = Record<string, string | number | boolean | null>;

export type ScenarioAssertionLink = {
  assertionId: string;
  params?: LinkParams;
};

// V1 SiteBootstrapHttpMethod enum names are uppercase.
export type EvalForgeBootstrapStep = {
  label?: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: Record<string, unknown>;
};

// V1 SiteSetupConfig is a discriminator enum (`mode`) + an aligned oneof. For
// `TEMPLATE`, the template id goes under the `templateOptions` branch — not flat.
export type EvalForgeSiteSetup = {
  mode: 'TEMPLATE';
  templateOptions: { templateId: string };
  bootstrap?: { steps: EvalForgeBootstrapStep[] };
};

export type EvalForgeBody = {
  name: string;
  description: string;
  triggerPrompt: string;
  assertionLinks: ScenarioAssertionLink[];
  siteSetup?: EvalForgeSiteSetup;
};

export function toEvalForgeBody(s: Scenario): EvalForgeBody {
  const body: EvalForgeBody = {
    name: s.name,
    description: s.description,
    triggerPrompt: s.triggerPrompt,
    assertionLinks: s.assertions.map(mapAssertion),
  };
  if (s.siteSetup) body.siteSetup = mapSiteSetup(s.siteSetup);
  return body;
}

function mapSiteSetup(s: SiteSetup): EvalForgeSiteSetup {
  const out: EvalForgeSiteSetup = { mode: 'TEMPLATE', templateOptions: { templateId: s.templateId } };
  // Omit bootstrap when it has no steps.
  if (s.bootstrap && s.bootstrap.steps.length > 0) {
    out.bootstrap = { steps: s.bootstrap.steps.map(mapBootstrapStep) };
  }
  return out;
}

function mapBootstrapStep(step: SiteBootstrapStep): EvalForgeBootstrapStep {
  // Schema methods are lowercase; V1's SiteBootstrapHttpMethod enum is uppercase.
  const out: EvalForgeBootstrapStep = {
    method: step.method.toUpperCase() as EvalForgeBootstrapStep['method'],
    url: step.url,
  };
  if (step.label !== undefined) out.label = step.label;
  if (step.body !== undefined) out.body = step.body;
  return out;
}

function mapAssertion(a: Assertion): ScenarioAssertionLink {
  if (isLlmJudge(a)) return mapLlmJudge(a);
  if (isApiCall(a)) return mapApiCall(a);
  if (isCost(a)) return mapCost(a);
  if (isTimeLimit(a)) return mapTimeLimit(a);
  return mapToolCall(a);
}

function mapToolCall(a: { tool: string; params?: Record<string, unknown>; negate?: boolean }): ScenarioAssertionLink {
  const params: LinkParams = {
    toolName: a.tool,
    expectedParams: JSON.stringify(a.params ?? {}),
  };
  if (a.negate !== undefined) params.negate = a.negate;
  return { assertionId: SYSTEM_TOOL_CALL, params };
}

function mapLlmJudge(a: LlmJudgeAssertion): ScenarioAssertionLink {
  const params: LinkParams = { prompt: a.prompt };
  if (a.minScore !== undefined) params.minScore = a.minScore;
  if (a.model !== undefined) params.model = a.model;
  if (a.maxTokens !== undefined) params.maxTokens = a.maxTokens;
  if (a.temperature !== undefined) params.temperature = a.temperature;
  if (a.negate !== undefined) params.negate = a.negate;
  return { assertionId: SYSTEM_LLM_JUDGE, params };
}

function mapApiCall(a: ApiCallAssertion): ScenarioAssertionLink {
  const params: LinkParams = {
    url: a.url,
    expectedResponse: jsonifyMaybe(a.expectedResponse),
  };
  if (a.method !== undefined) params.method = a.method;
  if (a.requestBody !== undefined) params.requestBody = jsonifyMaybe(a.requestBody);
  if (a.requestHeaders !== undefined) params.requestHeaders = jsonifyMaybe(a.requestHeaders);
  if (a.timeoutMs !== undefined) params.timeoutMs = a.timeoutMs;
  if (a.negate !== undefined) params.negate = a.negate;
  return { assertionId: SYSTEM_API_CALL, params };
}

function mapCost(a: CostAssertion): ScenarioAssertionLink {
  const params: LinkParams = { maxCostUsd: a.maxCostUsd };
  if (a.negate !== undefined) params.negate = a.negate;
  return { assertionId: SYSTEM_COST, params };
}

function mapTimeLimit(a: TimeLimitAssertion): ScenarioAssertionLink {
  const params: LinkParams = { maxDurationMs: a.maxDurationMs };
  if (a.negate !== undefined) params.negate = a.negate;
  return { assertionId: SYSTEM_TIME_LIMIT, params };
}

// EvalForge expects expectedResponse/requestBody/requestHeaders as JSON STRINGS. Authors may write
// a YAML object/array for ergonomics — stringify if so, pass through if already a string.
function jsonifyMaybe(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}
