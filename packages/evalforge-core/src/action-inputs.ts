/**
 * Input plumbing shared by the repo's EvalForge actions.
 *
 * `@actions/core` and the `github.context` payload are passed in rather than imported,
 * so this package gains no dependency on the Actions runtime — the real `core` module
 * and payload satisfy these shapes structurally.
 */
export type ActionsIo = {
  getInput(name: string, options?: { required?: boolean }): string;
  setSecret(value: string): void;
  warning(message: string): void;
};

export type PullRequestPayload = { pull_request?: { number?: number } | null };

/** Upgrades a non-HTTPS base URL, warning through the caller's logger. */
export function ensureHttps(io: ActionsIo, url: string): string {
  if (url.startsWith('https://')) return url;
  const upgraded = 'https://' + url.replace(/^https?:\/\//, '');
  io.warning(`evalforge-url was not HTTPS — upgraded to: ${upgraded}`);
  return upgraded;
}

/** Reads a required input and registers it for log masking. */
export function safeGetSecret(io: ActionsIo, name: string): string {
  const value = io.getInput(name, { required: true });
  io.setSecret(value);
  return value;
}

export function getPrNumber(payload: PullRequestPayload): number {
  const pr = payload.pull_request;
  if (!pr) throw new Error('No pull_request payload — action must be triggered by a pull_request event');
  const n = pr.number;
  if (!n) throw new Error('PR payload missing number');
  return n;
}
