import type { Scenario } from './schema';

type EvalForgeAssertion = {
  type: 'tool_called_with_param';
  name: string;
  description: string;
  config: {
    toolName: string;
    expectedParams: string;
  };
};

export type EvalForgeBody = {
  name: string;
  description: string;
  triggerPrompt: string;
  assertions: EvalForgeAssertion[];
};

// Map our author-friendly YAML shape to EvalForge's discriminated-union assertion shape.
// EvalForge's AssertionSchema requires { type, name, description, config }; our YAML uses
// { tool, params } for ergonomics. JSON-stringify params because config.expectedParams is a string.
export function toEvalForgeBody(s: Scenario): EvalForgeBody {
  return {
    name: s.name,
    description: s.description,
    triggerPrompt: s.triggerPrompt,
    assertions: s.assertions.map((a, i) => ({
      type: 'tool_called_with_param',
      name: `${s.name}#${i}`,
      description: `Verify ${a.tool} called with expected params`,
      config: {
        toolName: a.tool,
        expectedParams: JSON.stringify(a.params ?? {}),
      },
    })),
  };
}
