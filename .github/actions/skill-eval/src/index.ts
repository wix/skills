import * as core from '@actions/core';

async function main(): Promise<void> {
  const mode = core.getInput('mode') || 'eval';
  if (mode === 'cleanup') {
    core.info('Cleanup mode — not yet implemented');
    return;
  }
  const { run } = await import('./eval');
  await run();
}

main().catch(err => core.setFailed(err instanceof Error ? err.message : String(err)));
