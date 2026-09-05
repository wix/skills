/**
 * comment.ts — render the advisory PR comment: a pass/fail headline, dry-run and e2e
 * tables (failures first), and collapsed failure verdicts. Purely presentational.
 */
import { Resolved } from './resolve';
import { RunResult } from './evalforge';

export function buildComment(resolved: Resolved, verState: string, branch: string, results: RunResult[]): string {
  const dry = results.filter(r => r.kind === 'dry');
  const e2e = results.filter(r => r.kind === 'e2e');
  const passed = results.filter(r => r.judge === 'passed');
  const failed = results.filter(r => r.judge !== 'passed');
  const L: string[] = [];

  L.push(`### 🧪 Wix Headless skill eval — \`${branch}\``, '');
  L.push(`${failed.length ? '❌' : '✅'} **${passed.length}/${results.length} passed** · dry-run: ${dry.length} · e2e: ${e2e.length}${resolved.e2eFull ? ' (full set — `run-e2e-all`)' : ''} · entry version: _${verState}_ (branch-pinned)`);
  L.push('');

  const table = (title: string, items: RunResult[]) => {
    if (!items.length) return;
    L.push(`**${title}**`, '| | Scenario | Judge | Cost |', '|---|---|---|---|');
    // failures first, then alphabetical
    const sorted = [...items].sort((a, b) =>
      (a.judge === 'passed' ? 1 : 0) - (b.judge === 'passed' ? 1 : 0) || a.name.localeCompare(b.name));
    for (const r of sorted) {
      const ic = r.judge === 'passed' ? '✅' : '❌';
      const cost = r.cost != null ? `$${r.cost.toFixed(2)}` : '—';
      const name = r.name.replace(/^HS DR — /, '').replace(/^HS — /, '');
      L.push(`| ${ic} | ${name} | ${r.judge} | ${cost} |`);
    }
    L.push('');
  };
  table('Dry-run decisions', dry);
  table('End-to-end builds', e2e);

  if (failed.length) {
    L.push('<details><summary>Failure verdicts</summary>', '');
    for (const r of failed) L.push(`- **${r.name}** — ${(r.verdict || '').slice(0, 300)}`);
    L.push('', '</details>');
  }
  L.push('', '_Advisory check — does not block merge._');
  return L.join('\n');
}
