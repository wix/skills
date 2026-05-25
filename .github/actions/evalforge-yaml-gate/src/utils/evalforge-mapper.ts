import {
  isApiCall, isCost, isLlmJudge, isTimeLimit,
  type ApiCallAssertion, type Assertion, type CostAssertion,
  type LlmJudgeAssertion, type Scenario, type TimeLimitAssertion,
} from './schema';

// EvalForge AssertionSchema is a discriminated-union; each variant's fields are flat at top level.
// See packages/eval-types/src/assertion/assertion.ts in wix-private/evalforge.

type ToolCallEvalForgeAssertion = {
  type: 'tool_called_with_param';
  toolName: string;
  expectedParams: string; // JSON string
  negate?: boolean;
};

type LlmJudgeEvalForgeAssertion = {
  type: 'llm_judge';
  prompt: string;
  minScore?: number;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  negate?: boolean;
};

type ApiCallEvalForgeAssertion = {
  type: 'api_call';
  url: string;
  method?: 'GET' | 'POST';
  requestBody?: string;
  expectedResponse: string;
  requestHeaders?: string;
  timeoutMs?: number;
  negate?: boolean;
};

type CostEvalForgeAssertion = {
  type: 'cost';
  maxCostUsd: number;
  negate?: boolean;
};

type TimeLimitEvalForgeAssertion = {
  type: 'time_limit';
  maxDurationMs: number;
  negate?: boolean;
};

type EvalForgeAssertion =
  | ToolCallEvalForgeAssertion
  | LlmJudgeEvalForgeAssertion
  | ApiCallEvalForgeAssertion
  | CostEvalForgeAssertion
  | TimeLimitEvalForgeAssertion;

export type EvalForgeBody = {
  name: string;
  description: string;
  triggerPrompt: string;
  assertions: EvalForgeAssertion[];
};

export function toEvalForgeBody(s: Scenario): EvalForgeBody {
  return {
    name: s.name,
    description: s.description,
    triggerPrompt: s.triggerPrompt,
    assertions: s.assertions.map(mapAssertion),
  };
}

function mapAssertion(a: Assertion): EvalForgeAssertion {
  if (isLlmJudge(a)) return mapLlmJudge(a);
  if (isApiCall(a)) return mapApiCall(a);
  if (isCost(a)) return mapCost(a);
  if (isTimeLimit(a)) return mapTimeLimit(a);
  return {
    type: 'tool_called_with_param',
    toolName: a.tool,
    expectedParams: JSON.stringify(a.params ?? {}),
    ...(a.negate !== undefined && { negate: a.negate }),
  };
}

function mapLlmJudge(a: LlmJudgeAssertion): LlmJudgeEvalForgeAssertion {
  const out: LlmJudgeEvalForgeAssertion = { type: 'llm_judge', prompt: a.prompt };
  if (a.minScore !== undefined) out.minScore = a.minScore;
  if (a.model !== undefined) out.model = a.model;
  if (a.maxTokens !== undefined) out.maxTokens = a.maxTokens;
  if (a.temperature !== undefined) out.temperature = a.temperature;
  if (a.negate !== undefined) out.negate = a.negate;
  return out;
}

function mapApiCall(a: ApiCallAssertion): ApiCallEvalForgeAssertion {
  const out: ApiCallEvalForgeAssertion = {
    type: 'api_call',
    url: a.url,
    expectedResponse: jsonifyMaybe(a.expectedResponse),
  };
  if (a.method !== undefined) out.method = a.method;
  if (a.requestBody !== undefined) out.requestBody = jsonifyMaybe(a.requestBody);
  if (a.requestHeaders !== undefined) out.requestHeaders = jsonifyMaybe(a.requestHeaders);
  if (a.timeoutMs !== undefined) out.timeoutMs = a.timeoutMs;
  if (a.negate !== undefined) out.negate = a.negate;
  return out;
}

function mapCost(a: CostAssertion): CostEvalForgeAssertion {
  const out: CostEvalForgeAssertion = { type: 'cost', maxCostUsd: a.maxCostUsd };
  if (a.negate !== undefined) out.negate = a.negate;
  return out;
}

function mapTimeLimit(a: TimeLimitAssertion): TimeLimitEvalForgeAssertion {
  const out: TimeLimitEvalForgeAssertion = { type: 'time_limit', maxDurationMs: a.maxDurationMs };
  if (a.negate !== undefined) out.negate = a.negate;
  return out;
}

// EvalForge expects expectedResponse/requestBody/requestHeaders as JSON STRINGS. Authors may write
// a YAML object/array for ergonomics — stringify if so, pass through if already a string.
function jsonifyMaybe(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}
