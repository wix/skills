/**
 * evalforge.ts — thin EvalForge REST client + the run orchestration the gate needs:
 *   1. ensureBranchEntryVersion — a per-branch version of the entry skill whose install
 *      line targets the PR branch, so the eval tests the PR's skill (not published).
 *   2. selectScenarios — resolve the resolved tag set to concrete scenario ids.
 *   3. launch / poll — one eval-run per scenario, pinned to the branch version, then
 *      wait for judge results.
 *
 * Auth is simple header auth (x-app-id / x-app-secret). Base is bo.wix.com (NOT manage).
 * Every call retries a few times on 5xx because the backend can be transiently degraded.
 */
import * as fs from 'fs';

export interface RunResult {
  sid: string; name: string; tags: string[]; kind: 'dry' | 'e2e';
  judge: string; verdict: string; cost: number | null;
}
type Meta = { name: string; tags: string[]; kind: 'dry' | 'e2e' };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class EvalForge {
  constructor(private o: { base: string; project: string; appId: string; appSecret: string }) {}

  /** One REST call, retrying on 5xx (the backend OOM/timeouts intermittently). */
  async api(method: string, path: string, body?: unknown): Promise<any> {
    for (let i = 0; i < 5; i++) {
      try {
        const res = await fetch(`${this.o.base}/projects/${this.o.project}${path}`, {
          method,
          headers: { 'x-app-id': this.o.appId, 'x-app-secret': this.o.appSecret, 'Content-Type': 'application/json' },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        if ([500, 502, 503, 504].includes(res.status)) { await sleep(6000); continue; }
        const txt = await res.text();
        try { return JSON.parse(txt); } catch { return txt; }
      } catch { await sleep(6000); }
    }
    return null;
  }

  /**
   * Ensure an entry-skill capability version whose install line points at the PR branch,
   * so `npx skills add …/tree/<branch>` installs the PR's wix-headless skill.
   *
   * Cached per branch: we stamp `headless-pr-eval branch=<branch>` into the version notes
   * and reuse a matching version if one exists. Pinning a BRANCH (not a SHA) means the
   * install fetches the branch HEAD at run time, so later commits are covered automatically.
   *
   * IMPORTANT: inline files must go under `content.files`. The `content.skillContent.files`
   * shape is silently dropped, after which the version resolves from its GitHub `source`
   * (the published skill) and the branch install never takes effect. (Verified via POC.)
   */
  async ensureBranchEntryVersion(entryCap: string, branch: string, repo: string, entryFile: string) {
    const marker = `headless-pr-eval branch=${branch}`;
    const vers = await this.api('GET', `/capabilities/${entryCap}/versions`);
    const items: any[] = Array.isArray(vers) ? vers : (vers?.items ?? []);
    for (const v of items) if ((v.notes || '').includes(marker)) return { versionId: v.id as string, state: 'reused' };

    const md = fs.readFileSync(entryFile, 'utf8');
    const tree = `https://github.com/${repo}/tree/${branch}`;
    // Rewrite `npx skills@latest add wix/skills` → `… add https://github.com/<repo>/tree/<branch>`.
    let md2 = md.replace(/(npx skills@latest add )wix\/skills\b/, `$1${tree}`);
    if (md2 === md) md2 = md.replace(/(npx skills@latest add )https:\/\/github\.com\/\S+/, `$1${tree}`);
    const label = ('prb-' + branch.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 60);
    const resp = await this.api('POST', `/capabilities/${entryCap}/versions`, {
      version: label, origin: 'pr', notes: marker,
      content: { files: [{ path: 'SKILL.md', content: md2 }] },   // content.files — NOT content.skillContent.files
    });
    if (!resp?.id) throw new Error(`failed to create entry version: ${JSON.stringify(resp)}`);
    return { versionId: resp.id as string, state: 'created' };
  }

  /**
   * Resolve the tag selection to concrete scenarios.
   * Dry-run scenarios carry hs-dr-* tags; e2e builds carry hs-<vertical> tags — the two
   * namespaces don't overlap, so each scenario is unambiguously one kind.
   */
  async selectScenarios(dryRunTags: string[], e2eRun: string[]): Promise<Record<string, Meta>> {
    const scn = await this.api('GET', '/test-scenarios');
    const list: any[] = Array.isArray(scn) ? scn : [];
    const dry = new Set(dryRunTags), e2e = new Set(e2eRun);
    const picked: Record<string, Meta> = {};
    for (const s of list) {
      const tags = new Set<string>(s.tags || []);
      if ([...dry].some(t => tags.has(t))) picked[s.id] = { name: s.name, tags: [...tags].sort(), kind: 'dry' };
      else if ([...e2e].some(t => tags.has(t))) picked[s.id] = { name: s.name, tags: [...tags].sort(), kind: 'e2e' };
    }
    return picked;
  }

  /** Create + trigger one eval-run per scenario, each pinned to the branch entry version. */
  async launch(scenarios: Record<string, Meta>, agent: string, cap: string, ver: string) {
    const runs: Record<string, { sid: string } & Meta> = {};
    for (const [sid, meta] of Object.entries(scenarios)) {
      const resp = await this.api('POST', '/eval-runs', {
        projectId: this.o.project, name: 'PR-eval — ' + meta.name.slice(0, 60), description: 'headless PR eval',
        agentId: agent, capabilityIds: [cap], capabilityVersions: { [cap]: ver },   // pin to the branch version
        scenarioIds: [sid], runsPerScenario: 1,
      });
      if (resp?.id) { await this.api('POST', `/eval-runs/${resp.id}/run`); runs[resp.id] = { sid, ...meta }; }
    }
    return runs;
  }

  /**
   * Poll every launched run until it has a result (or a terminal job status), up to
   * timeoutMin. One run per scenario means a stuck run can't block the others; any run
   * still pending at the deadline is reported as `timeout`.
   */
  async poll(runs: Record<string, { sid: string } & Meta>, timeoutMin: number): Promise<RunResult[]> {
    const done: RunResult[] = [];
    const pending = new Map(Object.entries(runs));
    const deadline = Date.now() + timeoutMin * 60000;
    while (pending.size && Date.now() < deadline) {
      for (const rid of [...pending.keys()]) {
        const d = await this.api('GET', `/eval-runs/${rid}`);
        if (!d || typeof d !== 'object') continue;
        const res = d.results || [];
        if (res.length) {
          const aj: Record<string, any> = {};
          for (const a of res[0].assertionResults || []) aj[a.assertionType] = a;
          const j = aj['llm_judge'] || {};
          const m = pending.get(rid)!;
          done.push({ ...m, judge: j.status, verdict: j.details?.verdict || '', cost: aj['cost']?.details?.actualCostUsd ?? null });
          pending.delete(rid);
        } else if (d.jobStatus && !['RUNNING', 'PENDING'].includes(d.jobStatus)) {
          const m = pending.get(rid)!;
          done.push({ ...m, judge: 'no_result', verdict: `job=${d.jobStatus}`, cost: null });
          pending.delete(rid);
        }
      }
      if (pending.size) await sleep(20000);
    }
    for (const [, m] of pending) done.push({ ...m, judge: 'timeout', verdict: 'still running at poll timeout', cost: null });
    return done;
  }
}
