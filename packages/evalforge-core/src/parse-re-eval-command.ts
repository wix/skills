/**
 * Whether a PR comment is a `/re-eval` request.
 *
 * Deliberately strict. The workflow's `contains()` filter only decides whether to start a runner;
 * this decides whether money is spent. Anything looser turns discussing the feature — or quoting
 * someone who used it — into a live eval run.
 */
export type ReEvalCommand = { isCommand: true } | { isCommand: false };

const COMMAND = '/re-eval';

export function parseReEvalCommand(body: string): ReEvalCommand {
  const [firstLine = ''] = body.trim().split('\n');
  const [firstToken = ''] = firstLine.trim().split(/\s+/);
  return { isCommand: firstToken.toLowerCase() === COMMAND };
}
