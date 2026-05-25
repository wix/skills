import type { Scenario } from './schema';

// EvalForge AssertionSchema is a discriminated union with the discriminator + payload
// fields all at the top level (strictObject — extra keys are rejected). Phase 1 emits
// only `tool_called_with_param`. See packages/eval-types/src/assertion/assertion.ts in
// wix-private/evalforge.
type EvalForgeAssertion = {
  type: 'tool_called_with_param';
  toolName: string;
  expectedParams: string;  // JSON string, NOT an object
};

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
    assertions: s.assertions.map(a => ({
      type: 'tool_called_with_param',
      toolName: a.tool,
      expectedParams: JSON.stringify(a.params ?? {}),
    })),
  };
}
