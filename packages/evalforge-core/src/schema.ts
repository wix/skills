import { z } from 'zod';
import * as jsYaml from 'js-yaml';
import { CODE_TAG, REPO_PREFIX } from './evalforge';

const NamePattern = /^[a-z0-9][a-z0-9/_-]*$/;
export const RESERVED_TAG_PREFIXES = ['draft:', 'pending:', 'rejected:', REPO_PREFIX] as const;
export const RESERVED_TAGS = [CODE_TAG] as const;

const ParamScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

const ParamValueSchema = z.union([
  ParamScalarSchema,
  z.array(ParamScalarSchema),
]);

// For api_call expectedResponse/requestBody/requestHeaders: accept a YAML object/array (mapper
// JSON-stringifies it) or a literal JSON string (passed through).
const JsonStringOrStructured = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

const ToolCallAssertionSchema = z.object({
  type: z.literal('tool_called_with_param').optional(),
  tool: z.string().min(1),
  params: z.record(z.string(), ParamValueSchema).optional(),
  negate: z.boolean().optional(),
}).strict();

const LlmJudgeAssertionSchema = z.object({
  type: z.literal('llm_judge'),
  prompt: z.string().min(1),
  minScore: z.number().int().min(0).max(10).optional(),
  model: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(1).optional(),
  negate: z.boolean().optional(),
}).strict();

const ApiCallAssertionSchema = z.object({
  type: z.literal('api_call'),
  url: z.string().min(1),
  method: z.enum(['GET', 'POST']).optional(),
  requestBody: JsonStringOrStructured.optional(),
  expectedResponse: JsonStringOrStructured,
  requestHeaders: JsonStringOrStructured.optional(),
  timeoutMs: z.number().int().positive().optional(),
  negate: z.boolean().optional(),
}).strict();

const CostAssertionSchema = z.object({
  type: z.literal('cost'),
  maxCostUsd: z.number().positive(),
  negate: z.boolean().optional(),
}).strict();

const TimeLimitAssertionSchema = z.object({
  type: z.literal('time_limit'),
  maxDurationMs: z.number().int().positive(),
  negate: z.boolean().optional(),
}).strict();

const AssertionSchema = z.union([
  ToolCallAssertionSchema,
  LlmJudgeAssertionSchema,
  ApiCallAssertionSchema,
  CostAssertionSchema,
  TimeLimitAssertionSchema,
]);

export type ToolCallAssertion = z.infer<typeof ToolCallAssertionSchema>;
export type LlmJudgeAssertion = z.infer<typeof LlmJudgeAssertionSchema>;
export type ApiCallAssertion = z.infer<typeof ApiCallAssertionSchema>;
export type CostAssertion = z.infer<typeof CostAssertionSchema>;
export type TimeLimitAssertion = z.infer<typeof TimeLimitAssertionSchema>;
export type Assertion = z.infer<typeof AssertionSchema>;

// Optional per-scenario site provisioning. Only `template` mode is supported.
const SiteBootstrapStepSchema = z.object({
  label: z.string().optional(),
  method: z.enum(['get', 'post', 'put', 'patch', 'delete']),
  url: z.string().min(1),
  body: z.record(z.string(), z.unknown()).optional(),
}).strict();

const SiteBootstrapSchema = z.object({
  steps: z.array(SiteBootstrapStepSchema).default([]),
}).strict();

// `templateId` is a Wix template alias (e.g. "ecommerce") or a template GUID, resolved at
// provisioning time — any non-empty string is accepted here.
const SiteSetupSchema = z.object({
  mode: z.literal('template').default('template'),
  templateId: z.string().min(1),
  bootstrap: SiteBootstrapSchema.optional(),
}).strict();

export type SiteBootstrapStep = z.infer<typeof SiteBootstrapStepSchema>;
export type SiteSetup = z.infer<typeof SiteSetupSchema>;

export const ScenarioSchema = z.object({
  name: z.string().min(1).regex(NamePattern, 'name must match /^[a-z0-9][a-z0-9/_-]*$/'),
  description: z.string(),
  triggerPrompt: z.string().min(10),
  tags: z.array(z.string().min(1)).min(1).refine(
    tags => tags.every(t =>
      !RESERVED_TAG_PREFIXES.some(p => t.startsWith(p)) && !RESERVED_TAGS.some(r => t === r)),
    { message: 'tags must not include reserved namespaces (draft:*, pending:*, rejected:*, repo:*) or reserved tags (created-via-code) — the action manages those' },
  ),
  maxTokens: z.number().int().positive().optional(),
  assertions: z.array(AssertionSchema).min(1),
  siteSetup: SiteSetupSchema.optional(),
}).strict().superRefine((data, ctx) => {
  // A provisioned site supplies the site id, so siteSetup can't be combined with a {{site-id}} variable.
  if (data.siteSetup && /\{\{\s*site-id\s*\}\}/.test(data.triggerPrompt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'siteSetup cannot be combined with a {{site-id}} run variable in triggerPrompt — the provisioned site replaces it',
      path: ['triggerPrompt'],
    });
  }
});

export type Scenario = z.infer<typeof ScenarioSchema>;

export function isLlmJudge(a: Assertion): a is LlmJudgeAssertion {
  return a.type === 'llm_judge';
}

export function isApiCall(a: Assertion): a is ApiCallAssertion {
  return a.type === 'api_call';
}

export function isCost(a: Assertion): a is CostAssertion {
  return a.type === 'cost';
}

export function isTimeLimit(a: Assertion): a is TimeLimitAssertion {
  return a.type === 'time_limit';
}

export function isToolCall(a: Assertion): a is ToolCallAssertion {
  return a.type === undefined || a.type === 'tool_called_with_param';
}

export function parseScenario(raw: string): Scenario {
  // CORE_SCHEMA refuses unsafe YAML tags (e.g. !!js/function); defense in depth before Zod.
  const parsed = jsYaml.load(raw, { schema: jsYaml.CORE_SCHEMA });
  // Pre-flight: nested-object params get a clearer message than Zod's union error.
  // Only applies to tool-call assertions (which use `params`); other types have their own shapes.
  const obj = parsed as { assertions?: { type?: string; params?: Record<string, unknown> }[] } | null | undefined;
  if (obj?.assertions) {
    for (const a of obj.assertions) {
      const isToolCallShape = a?.type === undefined || a?.type === 'tool_called_with_param';
      if (!isToolCallShape || !a?.params) continue;
      for (const [k, v] of Object.entries(a.params)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          throw new Error(`nested object not allowed in tool params — params must be primitives or arrays of primitives. Offending key: assertions.params.${k}`);
        }
      }
    }
  }
  return ScenarioSchema.parse(parsed);
}
