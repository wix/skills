import * as core from '@actions/core';
import { getConfig } from './utils/config';
import * as github from '@actions/github';
import { getChangedFiles, upsertComment, fail } from './utils/github';
import { EvalForgeClient } from './utils/evalforge';
import { categorizeChanges } from './utils/paths';
import { collectSkillChanges } from './utils/skill-changes';
import { pollUntilDone } from './utils/eval-run';
import {
  formatValidationErrors, formatFailedJobMessage,
  formatServiceError, formatEvalPassed, formatEvalFailed, formatEvalTimeout, formatNoScenarios,
} from './utils/comment';
import type { ValidationError } from './utils/yaml';

async function run(): Promise<void> {
  const config = getConfig();
  const octokit = github.getOctokit(config.githubToken);

  core.info(`Skill eval — PR #${config.prNumber}`);

  let allFiles;
  try {
    allFiles = await getChangedFiles(octokit, config);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    core.error(`Failed to fetch changed files: ${message}`);
    await upsertComment(octokit, config, formatServiceError('Could not retrieve PR file list'));
    core.setFailed('Could not retrieve PR file list');
    return;
  }
  const { yamlFiles, mdFiles } = categorizeChanges(allFiles);

  if (yamlFiles.length === 0 && mdFiles.length === 0) {
    core.info('No relevant changes — skipping');
    return;
  }

  core.info(`Changed YAML files: ${yamlFiles.map(f => f.filename).join(', ') || 'none'}`);
  core.info(`Changed MD files: ${mdFiles.map(f => f.filename).join(', ') || 'none'}`);

  const { entries, errors } = await collectSkillChanges(
    octokit, config.owner, config.repo, yamlFiles, mdFiles, config.baseSha, process.env.GITHUB_WORKSPACE ?? process.cwd(),
  );

  if (entries.length === 0 && errors.length === 0) {
    core.info('No affected skill entries — skipping eval');
    return;
  }

  core.info(`Affected entries: ${entries.length}`);

  if (errors.length > 0) {
    await upsertComment(octokit, config, formatValidationErrors(errors));
    core.setFailed(formatFailedJobMessage(errors));
    return;
  }

  const evalforge = new EvalForgeClient(config.evalforgeUrl, config.appId, config.appSecret);

  let availableTags: Set<string>;
  try {
    availableTags = await evalforge.getTags(config.projectId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    core.error(`Failed to fetch EvalForge tags: ${message}`);
    await upsertComment(octokit, config, formatServiceError('Could not reach EvalForge — contact a repository maintainer if this persists', config.blocking));
    fail('EvalForge validation could not run', config.blocking);
    return;
  }

  const tagErrors: ValidationError[] = [];
  for (const entry of entries) {
    for (const tag of entry.tags!) {
      if (!availableTags.has(tag)) {
        tagErrors.push({ entryTitle: entry.title, message: `unknown tag "${tag}"` });
      }
    }
  }

  if (tagErrors.length > 0) {
    await upsertComment(octokit, config, formatValidationErrors(tagErrors));
    core.setFailed(formatFailedJobMessage(tagErrors));
    return;
  }

  const tags = [...new Set(entries.flatMap(e => e.tags!))];

  const versionLabel = `pr-${config.prNumber}-${config.headSha.slice(0, 7)}`;
  let mcpVersionId: string;
  try {
    const mcpVersion = await evalforge.createMcpVersion(config.mcpId, config.projectId, versionLabel, config.prNumber, config.headSha);
    mcpVersionId = mcpVersion.id;
    core.info(`Created MCP version ${versionLabel} (${mcpVersionId})`);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 409) {
      core.warning(`MCP version ${versionLabel} already exists — looking up existing version`);
      try {
        const versions = await evalforge.listMcpVersions(config.mcpId, config.projectId);
        const existing = versions.find(v => v.version === versionLabel);
        if (!existing) throw new Error(`Version ${versionLabel} not found after 409`);
        mcpVersionId = existing.id;
        core.info(`Reusing existing MCP version ${versionLabel} (${mcpVersionId})`);
      } catch (lookupErr) {
        const message = lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
        core.error(`Failed to look up existing MCP version: ${message}`);
        await upsertComment(octokit, config, formatServiceError('Could not look up existing MCP version — contact a repository maintainer if this persists', config.blocking));
        fail('Could not look up existing MCP version', config.blocking);
        return;
      }
    } else {
      const message = e instanceof Error ? e.message : String(e);
      core.error(`Failed to create MCP version: ${message}`);
      await upsertComment(octokit, config, formatServiceError('Could not create MCP version — contact a repository maintainer if this persists', config.blocking));
      fail('Could not create MCP version', config.blocking);
      return;
    }
  }

  let runId: string;
  try {
    const run = await evalforge.createEvalRun(config.projectId, {
      name: `PR #${config.prNumber} skill eval`,
      description: `Skill eval for PR #${config.prNumber}`,
      projectId: config.projectId,
      tags,
      agentId: config.agentId,
      capabilityVersions: { [config.mcpId]: mcpVersionId },
    });
    runId = run.id;
    core.info(`Created eval run ${runId}`);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 400) {
      const message = e instanceof Error ? e.message : String(e);
      core.error(`createEvalRun 400 — treating as no matching scenarios. Full error: ${message}`);
      await upsertComment(octokit, config, formatNoScenarios(tags, config.blocking));
      fail(`Skill evaluation failed: no scenarios matched tags: ${tags.join(', ')}`, config.blocking);
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    core.error(`Failed to create eval run: ${message}`);
    await upsertComment(octokit, config, formatServiceError('Could not create eval run — contact a repository maintainer if this persists', config.blocking));
    fail('Could not create eval run', config.blocking);
    return;
  }

  try {
    await evalforge.triggerEvalRun(config.projectId, runId);
    core.info(`Triggered eval run ${runId}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    core.error(`Failed to trigger eval run: ${message}`);
    await upsertComment(octokit, config, formatServiceError('Could not trigger eval run — contact a repository maintainer if this persists', config.blocking));
    fail('Could not trigger eval run', config.blocking);
    return;
  }

  core.info(`Polling eval run ${runId}...`);

  let finalStatus;
  try {
    finalStatus = await pollUntilDone(evalforge, config.projectId, runId);
  } catch (e) {
    if ((e as { timeout?: boolean }).timeout) {
      await upsertComment(octokit, config, formatEvalTimeout(runId, config.blocking));
      fail(`Skill evaluation timed out (run ID: ${runId})`, config.blocking);
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    core.error(`Eval run polling failed: ${message}`);
    await upsertComment(octokit, config, formatServiceError('Eval run polling failed — contact a repository maintainer if this persists', config.blocking));
    fail('Eval run polling failed', config.blocking);
    return;
  }

  const { aggregateMetrics: m } = finalStatus;

  if (finalStatus.status === 'completed') {
    if (m.failed === 0 && m.errors === 0) {
      await upsertComment(octokit, config, formatEvalPassed(m, runId));
      core.info(`Eval passed — ${m.passed}/${m.totalAssertions} assertions passed (pass rate: ${m.passRate}%, run ID: ${runId})`);
    } else {
      await upsertComment(octokit, config, formatEvalFailed(m, runId, config.blocking));
      core.info(`Eval result — ${m.failed} assertions failed, ${m.errors} errors, ${m.passed}/${m.totalAssertions} passed (pass rate: ${m.passRate}%, run ID: ${runId})`);
      fail(`Skill evaluation failed (pass rate: ${m.passRate}%)`, config.blocking);
    }
  } else {
    await upsertComment(octokit, config, formatServiceError(`Eval run ended with unexpected status: ${finalStatus.status} (run ID: ${runId})`, config.blocking));
    fail(`Eval run ended with unexpected status: ${finalStatus.status}`, config.blocking);
  }
}

run().catch(err => core.setFailed(err instanceof Error ? err.message : String(err)));
