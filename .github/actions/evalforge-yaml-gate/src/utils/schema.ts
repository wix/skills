import { z } from 'zod';
import * as jsYaml from 'js-yaml';

const NamePattern = /^[a-z0-9][a-z0-9/_-]*$/;
export const RESERVED_TAG_PREFIXES = ['draft:', 'pending:', 'rejected:'] as const;

const ParamScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

const ParamValueSchema = z.union([
  ParamScalarSchema,
  z.array(ParamScalarSchema),
]);

const AssertionSchema = z.object({
  tool: z.string().min(1),
  params: z.record(z.string(), ParamValueSchema).optional(),
}).strict();

export const ScenarioSchema = z.object({
  name: z.string().min(1).regex(NamePattern, 'name must match /^[a-z0-9][a-z0-9/_-]*$/'),
  description: z.string(),
  triggerPrompt: z.string().min(10),
  tags: z.array(z.string().min(1)).min(1).refine(
    tags => tags.every(t => !RESERVED_TAG_PREFIXES.some(p => t.startsWith(p))),
    { message: 'tags must not include reserved namespaces (draft:*, pending:*, rejected:*) — the action manages those' },
  ),
  assertions: z.array(AssertionSchema).min(1),
}).strict();

export type Scenario = z.infer<typeof ScenarioSchema>;

export function parseScenario(raw: string): Scenario {
  // CORE_SCHEMA refuses unsafe YAML tags (e.g. !!js/function); defense in depth before Zod.
  const parsed = jsYaml.load(raw, { schema: jsYaml.CORE_SCHEMA });
  // Pre-flight: nested-object params get a clearer message than Zod's union error.
  const obj = parsed as { assertions?: { params?: Record<string, unknown> }[] } | null | undefined;
  if (obj?.assertions) {
    for (const a of obj.assertions) {
      if (!a?.params) continue;
      for (const [k, v] of Object.entries(a.params)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          throw new Error(`nested object params not supported (Phase 1): assertions.params.${k}`);
        }
      }
    }
  }
  return ScenarioSchema.parse(parsed);
}
