import * as fs from 'fs';
import { Resolved } from './resolve';

export interface RunResult {
  sid: string; name: string; tags: string[]; kind: 'dry' | 'e2e';
  judge: string; verdict: string; cost: number | null;
}
type Meta = { name: string; tags: string[]; kind: 'dry' | 'e2e' };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class EvalForge {
  constructor(private o: { base: string; project: string; appId: string; appSecret: string }) {}

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

  /** Reuse the entry-skill version for this branch, else create one whose install
   *  line targets github.com/<repo>/tree/<branch>. */
  async ensureBranchEntryVersion(entryCap: string, branch: string, repo: string, entryFile: string) {
    const marker = `headless-pr-eval branch=${branch}`;
    const vers = await this.api('GET', `/capabilities/${entryCap}/versions`);
    const items: any[] = Array.isArray(vers) ? vers : (vers?.items ?? []);
    for (const v of items) if ((v.notes || '').includes(marker)) return { versionId: v.id as string, state: 'reused' };

    const md = fs.readFileSync(entryFile, 'utf8');
    const tree = `https://github.com/${repo}/tree/${branch}`;
    let md2 = md.replace(/(npx skills@latest add )wix\/skills\b/, `$1${tree}`);
    if (md2 === md) md2 = md.replace(/(npx skills@latest add )https:\/\/github\.com\/\S+/, `$1${tree}`);
    const label = ('prb-' + branch.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 60);
    const resp = await this.api('POST', `/capabilities/${entryCap}/versions`, {
      version: label, origin: 'pr', notes: marker,
      // NB: inline files live under content.files (NOT content.skillContent.files); the
      // wrong shape is silently dropped and the version resolves from its GitHub source
      // (the published skill), so the branch install never takes effect. Verified via POC.
      content: { files: [{ path: 'SKILL.md', content: md2 }] },
    });
    if (!resp?.id) throw new Error(`failed to create entry version: ${JSON.stringify(resp)}`);
    return { versionId: resp.id as string, state: 'created' };
  }

  async selectScenarios(r: Resolved): Promise<Record<string, Meta>> {
    const scn = await this.api('GET', '/test-scenarios');
    const list: any[] = Array.isArray(scn) ? scn : [];
    const dryTags = new Set(r.dryRunTags), e2eTags = new Set(r.e2eRun);
    const picked: Record<string, Meta> = {};
    for (const s of list) {
      const tags = new Set<string>(s.tags || []);
      let kind: 'dry' | 'e2e' | null = null;
      if (r.dryRunAll && tags.has('hs-dry-run')) kind = 'dry';
      else if (!r.dryRunAll && [...dryTags].some(t => tags.has(t))) kind = 'dry';
      if (!kind && [...e2eTags].some(t => tags.has(t)) && !tags.has('hs-dry-run')) kind = 'e2e';
      if (kind) picked[s.id] = { name: s.name, tags: [...tags].sort(), kind };
    }
    return picked;
  }

  async launch(scenarios: Record<string, Meta>, agent: string, cap: string, ver: string) {
    const runs: Record<string, { sid: string } & Meta> = {};
    for (const [sid, meta] of Object.entries(scenarios)) {
      const resp = await this.api('POST', '/eval-runs', {
        projectId: this.o.project, name: 'PR-eval — ' + meta.name.slice(0, 60), description: 'headless PR eval',
        agentId: agent, capabilityIds: [cap], capabilityVersions: { [cap]: ver },
        scenarioIds: [sid], runsPerScenario: 1,
      });
      if (resp?.id) { await this.api('POST', `/eval-runs/${resp.id}/run`); runs[resp.id] = { sid, ...meta }; }
    }
    return runs;
  }

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
