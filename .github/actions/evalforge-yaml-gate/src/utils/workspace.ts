export function workspaceRoot(): string {
  return process.env.GITHUB_WORKSPACE ?? process.cwd();
}
