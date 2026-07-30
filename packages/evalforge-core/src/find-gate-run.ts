/**
 * Locates the gate workflow run that `/re-eval` should re-run.
 *
 * `/re-eval` re-runs the PR's own `pull_request` run rather than evaluating in a second workflow,
 * because an `issue_comment` run is associated with the default branch's commit while required
 * checks are evaluated on the PR head. A second workflow would therefore pass somewhere the PR
 * cannot see, leaving the original failed check in place and the PR unmergeable.
 */
export const GateRunLookup = {
  FOUND: 'FOUND',
  NONE: 'NONE',
  ACTIVE: 'ACTIVE',
  TOO_OLD: 'TOO_OLD',
} as const;

export type GateRunResult =
  | { kind: typeof GateRunLookup.FOUND; runId: number; runUrl: string }
  | { kind: typeof GateRunLookup.NONE }
  | { kind: typeof GateRunLookup.ACTIVE; runUrl: string }
  | { kind: typeof GateRunLookup.TOO_OLD; completedAt: string };

/**
 * The slice of Octokit this module needs. Declared structurally so the package takes no dependency
 * on `@actions/github` — a real Octokit satisfies it.
 */
export type WorkflowRunsClient = {
  rest: {
    actions: {
      listWorkflowRuns: (params: {
        owner: string;
        repo: string;
        workflow_id: string;
        event: string;
        head_sha: string;
        per_page: number;
      }) => Promise<{
        data: {
          workflow_runs: Array<{
            id: number;
            html_url: string;
            status?: string | null;
            updated_at: string;
          }>;
        };
      }>;
    };
  };
};

/** GitHub allows re-running a workflow run for 30 days after it completes. */
export const RERUN_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function findGateRun(
  octokit: WorkflowRunsClient,
  target: { owner: string; repo: string; workflowFile: string; headSha: string; now: Date },
): Promise<GateRunResult> {
  const { data } = await octokit.rest.actions.listWorkflowRuns({
    owner: target.owner,
    repo: target.repo,
    workflow_id: target.workflowFile,
    // The gate's own trigger, so a differently-triggered run of the same file cannot be picked up.
    // The API returns newest first, so a single item is the latest attempt.
    event: 'pull_request',
    head_sha: target.headSha,
    per_page: 1,
  });

  const [latest] = data.workflow_runs;
  if (!latest) return { kind: GateRunLookup.NONE };

  // Anything other than `completed` — queued, in_progress, waiting, pending, requested — is a run
  // we must not race. Tested against the whole set rather than the two obvious values.
  if (latest.status !== 'completed') {
    return { kind: GateRunLookup.ACTIVE, runUrl: latest.html_url };
  }

  const ageDays = (target.now.getTime() - new Date(latest.updated_at).getTime()) / MS_PER_DAY;
  if (ageDays > RERUN_WINDOW_DAYS) {
    return { kind: GateRunLookup.TOO_OLD, completedAt: latest.updated_at };
  }
  return { kind: GateRunLookup.FOUND, runId: latest.id, runUrl: latest.html_url };
}
