import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

// The EvalForge secrets live in the `evalforge` environment, which only `main` may use. A job that
// reads one without naming the environment silently falls back to a repository secret — readable
// by any workflow pushed on any branch — or, once those are deleted, gets an empty value.
const EVALFORGE_SECRETS = [
  'AUTO_SKILLS_PIPELINE_APP_ID',
  'AUTO_SKILLS_PIPELINE_APP_SECRET',
  'ANTHROPIC_API_KEY',
  'SLACK_WEBHOOK_URL',
];

const WORKFLOWS = join(__dirname, '../../../workflows');

type Job = { environment?: string | { name?: string } };

const jobsUsingEvalForgeSecrets = readdirSync(WORKFLOWS)
  .filter(file => file.endsWith('.yml'))
  .flatMap(file => {
    const workflow = yaml.load(readFileSync(join(WORKFLOWS, file), 'utf-8')) as { jobs?: Record<string, Job> };
    return Object.entries(workflow.jobs ?? {})
      .filter(([, job]) => EVALFORGE_SECRETS.some(name => JSON.stringify(job).includes(`secrets.${name}`)))
      .map(([id, job]) => ({ id: `${file}:${id}`, job }));
  });

describe('EvalForge secrets environment', () => {
  it('finds the jobs that read EvalForge secrets', () => {
    expect(jobsUsingEvalForgeSecrets.length).toBeGreaterThan(0);
  });

  it.each(jobsUsingEvalForgeSecrets.map(({ id, job }) => [id, job] as const))(
    '%s runs in the evalforge environment',
    (_id, job) => {
      const environment = typeof job.environment === 'string' ? job.environment : job.environment?.name;
      expect(environment).toBe('evalforge');
    },
  );
});
