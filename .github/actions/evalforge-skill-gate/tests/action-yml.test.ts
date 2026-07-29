import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import {
  DEFAULT_BROAD_IMPACT_GLOBS, DEFAULT_IGNORE_GLOBS, DEFAULT_MAX_SCENARIOS, DEFAULT_REFERENCE_DIR,
} from '@wix/evalforge-core';

type ActionInput = { description: string; required?: boolean; default?: string };
type ActionYml = { name: string; inputs: Record<string, ActionInput>; runs: { main: string } };

const action = yaml.load(readFileSync(join(__dirname, '../action.yml'), 'utf8')) as ActionYml;

const lines = (value: string | undefined) =>
  (value ?? '').split('\n').map(line => line.trim()).filter(line => line !== '');

describe('action.yml', () => {
  it('declares every input the gate and cleanup configs read', () => {
    for (const name of [
      'mode', 'github-token', 'evalforge-url', 'evalforge-project-id',
      'evalforge-app-id', 'evalforge-app-secret', 'evals-glob',
      'capability-id', 'agent-id', 'skill-dir', 'reference-dir',
      'ignore-globs', 'broad-impact-globs', 'max-scenarios', 'blocking',
    ]) {
      expect(Object.keys(action.inputs), name).toContain(name);
    }
  });

  it('keeps ignore-globs in step with the core default', () => {
    expect(lines(action.inputs['ignore-globs'].default)).toEqual(DEFAULT_IGNORE_GLOBS);
  });

  it('keeps broad-impact-globs in step with the core default', () => {
    expect(lines(action.inputs['broad-impact-globs'].default)).toEqual(DEFAULT_BROAD_IMPACT_GLOBS);
  });

  it('documents the reviewed max-scenarios and soak defaults', () => {
    expect(action.inputs['max-scenarios'].default).toBe(String(DEFAULT_MAX_SCENARIOS));
    expect(action.inputs.blocking.default).toBe('false');
    expect(action.inputs['reference-dir'].default).toBe(DEFAULT_REFERENCE_DIR);
  });

  it('leaves gate-only inputs optional so sync mode needs none of them', () => {
    for (const name of ['capability-id', 'agent-id', 'skill-dir']) {
      expect(action.inputs[name].required, name).toBeFalsy();
    }
  });

  it('runs the committed bundle', () => {
    expect(action.runs.main).toBe('dist/index.js');
  });
});
