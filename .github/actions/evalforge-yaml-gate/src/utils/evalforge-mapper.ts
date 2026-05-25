import { isLlmJudge, type Assertion, type LlmJudgeAssertion, type Scenario } from './schema';

// EvalForge AssertionSchema is a discriminated-union; each variant's fields are flat at top level.
// See packages/eval-types/src/assertion/assertion.ts in wix-private/evalforge.

type ToolCallEvalForgeAssertion = {
  type: 'tool_called_with_param';
  toolName: string;
  expectedParams: string; // JSON string
};

type LlmJudgeEvalForgeAssertion = {
  type: 'llm_judge';
  prompt: string;
  minScore?: number;
  model?: string;
  maxTokens?: number;
  temperature?: number;
};

type EvalForgeAssertion = ToolCallEvalForgeAssertion | LlmJudgeEvalForgeAssertion;

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
  return {
    type: 'tool_called_with_param',
    toolName: a.tool,
    expectedParams: JSON.stringify(a.params ?? {}),
  };
}

function mapLlmJudge(a: LlmJudgeAssertion): LlmJudgeEvalForgeAssertion {
  const out: LlmJudgeEvalForgeAssertion = { type: 'llm_judge', prompt: a.prompt };
  if (a.minScore !== undefined) out.minScore = a.minScore;
  if (a.model !== undefined) out.model = a.model;
  if (a.maxTokens !== undefined) out.maxTokens = a.maxTokens;
  if (a.temperature !== undefined) out.temperature = a.temperature;
  return out;
}
