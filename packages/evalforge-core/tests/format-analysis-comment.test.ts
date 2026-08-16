import { describe, it, expect } from 'vitest';
import {
  ANALYSIS_COMMENT_MARKER, MAX_COMMENT_BODY_LENGTH,
  formatAnalysisComment, formatAnalysisSuperseded, formatAnalysisUnavailable,
} from '../src/format-analysis-comment';
import { GATE_COMMENT_MARKER } from '../src/format-gate-comment';
import type { RunAnalysis, RunAnalysisFinding } from '../src/evalforge';

const RUN_ID = 'run-123';
const RUN_URL = 'https://bo.wix.com/pages/evalforge/proj/results?runId=run-123';

const finding = (over: Partial<RunAnalysisFinding> = {}): RunAnalysisFinding => ({
  category: 'FAILURE_PATTERN',
  severity: 'MEDIUM',
  description: 'Something went wrong.',
  affectedScenarios: ['scenario-a'],
  ...over,
});

const analysis = (over: Partial<RunAnalysis> = {}): RunAnalysis => ({
  summary: 'A short summary.',
  findings: [finding()],
  ...over,
});

const render = (over: Partial<RunAnalysis> = {}) =>
  formatAnalysisComment({ analysis: analysis(over), runId: RUN_ID, runUrl: RUN_URL });

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('formatAnalysisComment', () => {
  it('carries its own marker, distinct from the gate comment', () => {
    const body = render();
    expect(body.startsWith(ANALYSIS_COMMENT_MARKER)).toBe(true);
    expect(ANALYSIS_COMMENT_MARKER).not.toBe(GATE_COMMENT_MARKER);
    expect(body).not.toContain(GATE_COMMENT_MARKER);
  });

  it('collapses the detail behind a details block, with the blank line GitHub needs', () => {
    const body = render();
    expect(body).toContain('<details>');
    expect(body).toContain('</details>');
    expect(body).toContain('<summary>Full investigation</summary>\n\n');
  });

  it('tallies findings by severity above the fold', () => {
    const body = render({
      findings: [
        finding({ severity: 'HIGH' }),
        finding({ severity: 'HIGH' }),
        finding({ severity: 'MEDIUM' }),
        finding({ severity: 'LOW', category: 'POSITIVE' }),
      ],
    });
    expect(body).toContain('**4 findings**');
    expect(body).toContain('2 high');
    expect(body).toContain('1 medium');
    expect(body).toContain('1 positive');
  });

  it('says "1 finding" rather than "1 findings"', () => {
    expect(render({ findings: [finding()] })).toContain('**1 finding**');
  });

  it('links the run', () => {
    expect(render()).toContain(RUN_URL);
  });

  it('orders findings high to low, with positives last regardless of severity', () => {
    const body = render({
      findings: [
        finding({ severity: 'LOW', description: 'the-low' }),
        finding({ severity: 'HIGH', category: 'POSITIVE', description: 'the-positive' }),
        finding({ severity: 'HIGH', description: 'the-high' }),
        finding({ severity: 'MEDIUM', description: 'the-medium' }),
      ],
    });
    const positions = ['the-high', 'the-medium', 'the-low', 'the-positive']
      .map(needle => body.indexOf(needle));
    expect(positions.every(index => index >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('humanises the category and renders scenarios and recommendation', () => {
    const body = render({
      findings: [finding({
        category: 'SKILL_MISGUIDANCE',
        severity: 'HIGH',
        description: 'The reference misleads.',
        affectedScenarios: ['scenario-a', 'scenario-b'],
        recommendation: 'Reorder the steps.',
      })],
    });
    expect(body).toContain('Skill misguidance');
    expect(body).not.toContain('SKILL_MISGUIDANCE');
    expect(body).toContain('`scenario-a`');
    expect(body).toContain('`scenario-b`');
    expect(body).toContain('Reorder the steps.');
  });

  it('omits the recommendation line when there is none', () => {
    expect(render({ findings: [finding()] })).not.toContain('Recommendation');
  });

  it('renders a positive finding without a severity dot, matching how the tally counts it', () => {
    const body = render({ findings: [finding({ category: 'POSITIVE', severity: 'HIGH' })] });
    expect(body).toContain('### Strength');
    expect(body).not.toContain('🔴');
    expect(body).not.toContain('High');
  });

  it('renders the generation time in the footer when the analysis carries one', () => {
    const body = render({ generatedAt: '2026-08-12T14:03:22.512Z' });
    expect(body).toContain('2026-08-12 14:03 UTC');
    expect(body).toMatch(/eval run run-123<\/a> · 2026-08-12 14:03 UTC<\/sub>/);
  });

  it('omits the time and its separator when the analysis carries none', () => {
    const body = render();
    expect(body).toContain(`eval run ${RUN_ID}</a></sub>`);
    expect(body).not.toContain('UTC');
  });

  it('drops an unparseable generation time rather than rendering it raw', () => {
    const body = render({ generatedAt: 'not-a-timestamp' });
    expect(body).not.toContain('not-a-timestamp');
    expect(body).toContain(`eval run ${RUN_ID}</a></sub>`);
  });

  it('neutralises a closing details tag in a finding, so one finding cannot unfold the rest', () => {
    const body = render({
      findings: [
        finding({ description: 'Quoting </details> in prose.', recommendation: 'Avoid </details> too.' }),
        finding({ description: 'the-later-finding' }),
      ],
    });
    expect(body.split('</details>')).toHaveLength(2);
    expect(body).toContain('&lt;/details&gt;');
    expect(body.indexOf('the-later-finding')).toBeLessThan(body.indexOf('</details>'));
  });

  // GitHub honours all three spellings, so a literal case-sensitive match leaves the hole open.
  // Counted with the same permissive pattern, since `</details >` does not contain `</details>`
  // literally — a plain split on the canonical form would pass without neutralising anything.
  it.each(['</DETAILS>', '</Details>', '</details >'])('neutralises the %s spelling too', (variant) => {
    const body = render({ findings: [finding({ description: `Quoting ${variant} in prose.` })] });

    expect(body.match(/<\/\s*details\s*>/gi)).toHaveLength(1);
    expect(body).toContain('&lt;/');
  });

  it('neutralises a closing details tag in the folded summary', () => {
    const body = render({ summary: `Narrative mentioning </details>.\n\nSecond paragraph.` });
    expect(body.split('</details>')).toHaveLength(2);
  });

  it('renders an UNKNOWN category and severity without inventing one', () => {
    const body = render({ findings: [finding({ category: 'UNKNOWN', severity: 'UNKNOWN' })] });
    expect(body).not.toContain('UNKNOWN');
    expect(body).not.toContain('High');
    expect(body).toContain('Uncategorised');
  });

  // Every other assertion in this file is satisfied by either copy, which is how the duplicate
  // survived review — so count, never `toContain`.
  it('prints a short summary once, not again inside the fold', () => {
    const summary = 'All three failures trace to the same reordered step in DASHBOARD_PAGE.md.';

    expect(occurrences(render({ summary }), summary)).toBe(1);
  });

  it('prints a short summary once on the findings-free path too', () => {
    const summary = 'Nothing of note.';

    expect(occurrences(render({ summary, findings: [] }), summary)).toBe(1);
  });

  it('still carries the whole summary in the fold when the teaser showed only its first paragraph', () => {
    const body = render({ summary: 'The first paragraph.\n\nA second paragraph with the detail.' });
    const [above, folded] = body.split('<details>');

    expect(above).toContain('The first paragraph.');
    expect(above).not.toContain('A second paragraph');
    expect(folded).toContain('The first paragraph.');
    expect(folded).toContain('A second paragraph with the detail.');
  });

  // The overlap here is intended: an excerpt above, the full narrative inside, like an article
  // preview. Only the exact duplicate is a defect.
  it('excerpts a long summary above the fold and keeps the full narrative inside', () => {
    const body = render({ summary: `${'word '.repeat(200)}the-tail-word` });
    const [above, folded] = body.split('<details>');

    expect(above).toContain('…');
    expect(above).not.toContain('the-tail-word');
    expect(folded).toContain('the-tail-word');
  });

  it('leaves a short summary intact', () => {
    const body = render({ summary: 'A short summary.' });
    expect(body).toContain('A short summary.');
    expect(body).not.toContain('…');
  });

  it('cuts the teaser at a word boundary', () => {
    const teaser = render({ summary: `${'word '.repeat(200)}end` }).split('<details>')[0];
    expect(teaser).toContain('…');
    expect(teaser).not.toMatch(/wor…/);
  });

  it('keeps the body within budget and says what it dropped', () => {
    const body = render({
      summary: 'x'.repeat(100_000),
      findings: Array.from({ length: 400 }, (_unused, index) =>
        finding({ severity: 'HIGH', description: `finding-${index} ${'y'.repeat(1_000)}` })),
    });
    expect(body.length).toBeLessThanOrEqual(MAX_COMMENT_BODY_LENGTH);
    // "further" would claim the omitted findings are the tail; the loop keeps packing shorter
    // findings in after dropping a long one, so they are not.
    expect(body).toMatch(/_\d+ findings? omitted — /);
    expect(body).not.toContain('further');
  });

  it('keeps the body within budget when many short findings all survive the fold', () => {
    const body = render({
      findings: Array.from({ length: 600 }, () => finding({ severity: 'HIGH', description: 'y'.repeat(80) })),
    });
    expect(body.length).toBeLessThanOrEqual(MAX_COMMENT_BODY_LENGTH);
  });

  it('keeps the marker, tally and run link even when truncating', () => {
    const body = render({
      summary: 'x'.repeat(100_000),
      findings: Array.from({ length: 400 }, () => finding({ description: 'y'.repeat(5_000) })),
    });
    expect(body.startsWith(ANALYSIS_COMMENT_MARKER)).toBe(true);
    expect(body).toContain('**400 findings**');
    expect(body).toContain(RUN_URL);
  });

  it('reports a findings-free analysis as clean rather than rendering an empty list', () => {
    const body = render({ summary: 'Nothing of note.', findings: [] });
    expect(body).toContain('No findings');
    expect(body).not.toContain('<details>');
  });
});

describe('formatAnalysisUnavailable', () => {
  it('names the reason and keeps the run reachable', () => {
    const body = formatAnalysisUnavailable({
      reason: 'the analysis exceeded its budget',
      runId: RUN_ID,
      runUrl: RUN_URL,
    });
    expect(body.startsWith(ANALYSIS_COMMENT_MARKER)).toBe(true);
    expect(body).toContain('the analysis exceeded its budget');
    expect(body).toContain(RUN_URL);
  });

  it('caps a runaway reason itself, rather than trusting its caller to', () => {
    const body = formatAnalysisUnavailable({
      reason: 'x'.repeat(100_000),
      runId: RUN_ID,
      runUrl: RUN_URL,
    });
    expect(body.length).toBeLessThan(1_000);
  });
});

describe('formatAnalysisSuperseded', () => {
  it('retracts the earlier investigation under the same marker, keeping the run reachable', () => {
    const body = formatAnalysisSuperseded({ runId: RUN_ID, runUrl: RUN_URL });
    expect(body.startsWith(ANALYSIS_COMMENT_MARKER)).toBe(true);
    expect(body).toContain('no longer applies');
    expect(body).toContain('no failing assertions');
    expect(body).toContain(RUN_URL);
  });

  it('stays short enough to read as a one-line note', () => {
    expect(formatAnalysisSuperseded({ runId: RUN_ID, runUrl: RUN_URL }).length).toBeLessThan(400);
  });
});
