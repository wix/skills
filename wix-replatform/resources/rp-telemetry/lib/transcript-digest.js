'use strict';

// Deterministic digest of a Claude Code session transcript (spec 0039 §3-4).
//
// Pure function over JSONL already on disk: no model call, no network, no
// judgment. Given the same transcript files it must return byte-identical
// output, so every derived number here comes straight from fields Claude Code
// itself writes to the transcript — never from a guess or a heuristic that
// could drift between runs.
//
// Two loci write the identical JSONL shape (spec 0039 §4, §8.1): a local run
// under `~/.claude/projects/<escaped-cwd>/<sessionId>.jsonl`, and a sandbox
// run under `.persist/claude/projects/` inside the checkpoint (the sandbox
// symlinks `~/.claude` into the checkpointed tree). This module only ever
// reads a list of file paths, so it does not care which locus produced them.

const fs = require('node:fs');
const path = require('node:path');

// A repeated identical tool call is the signature of the unbounded-retry hang
// class (spec 0039 §3) — this is the threshold at which a streak counts as a
// loop rather than ordinary retry-with-backoff.
const RETRY_LOOP_MIN_REPEATS = 3;
// A gap this long between two timestamped transcript records is time the
// human or an external system held the run, not active agent work — mirrors
// the recorder's own IMPLICIT_WAIT_MIN_MS (telemetry-recorder.js) so the two
// idle notions agree on the same threshold.
const IDLE_GAP_MIN_MS = 60 * 1000;
const TOP_FAILING_MAX = 10;
const RETRY_LOOPS_MAX = 10;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Claude Code's own project-directory escaping: every character outside
// [A-Za-z0-9] becomes `-` (verified against this repo's own
// ~/.claude/projects/<escaped-cwd> directory names).
function escapeCwd(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, '-');
}

function readSessionRecords(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const records = [];
  let malformed = 0;
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      malformed += 1;
    }
  }
  return { records, malformed };
}

// First/last top-level `timestamp` and the `cwd` of a session file, without
// holding the whole parse result — used to decide which sibling sessions
// belong to this run before paying for the full digest pass.
function peekSession(file) {
  const { records } = readSessionRecords(file);
  let firstTs = null;
  let lastTs = null;
  let cwd = null;
  for (const record of records) {
    if (typeof record.timestamp !== 'string') continue;
    const ms = Date.parse(record.timestamp);
    if (!Number.isFinite(ms)) continue;
    if (firstTs === null) firstTs = ms;
    lastTs = ms;
    if (cwd === null && typeof record.cwd === 'string') cwd = record.cwd;
  }
  return { firstTs, lastTs, cwd };
}

// Every sibling `.jsonl` in the same project directory as `anchorTranscript`
// whose recorded `cwd` matches and whose time range overlaps
// [windowStartMs, windowEndMs]. A resumed run spans several sessionIds (spec
// 0039 §4, §8.1) — this is the correlation the manifest (§4.1) then writes
// down once so a later reader never has to re-derive it.
function discoverRunSessions(anchorTranscript, { windowStartMs, windowEndMs }) {
  const dir = path.dirname(anchorTranscript);
  const anchor = peekSession(anchorTranscript);
  const cwd = anchor.cwd;
  const entries = fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
  const included = [];
  for (const name of entries) {
    const file = path.join(dir, name);
    const info = peekSession(file);
    if (info.firstTs === null) continue;
    if (cwd !== null && info.cwd !== null && info.cwd !== cwd) continue;
    if (info.lastTs < windowStartMs || info.firstTs > windowEndMs) continue;
    included.push({
      sessionId: path.basename(name, '.jsonl'),
      path: file,
      firstTs: info.firstTs,
      lastTs: info.lastTs,
    });
  }
  included.sort((a, b) => a.firstTs - b.firstTs);
  if (included.length === 0) {
    // The anchor transcript itself always counts, even if its own window
    // check above (identical file) somehow fails a boundary comparison.
    included.push({ sessionId: path.basename(anchorTranscript, '.jsonl'), path: anchorTranscript, ...anchor });
  }
  return included;
}

function toolUseBlocks(message) {
  const content = message && message.content;
  if (!Array.isArray(content)) return [];
  return content.filter((c) => c && c.type === 'tool_use');
}

function toolResultBlocks(message) {
  const content = message && message.content;
  if (!Array.isArray(content)) return [];
  return content.filter((c) => c && c.type === 'tool_result');
}

// A genuine human turn, as distinct from a tool result: both travel as
// `type: "user"` records in Claude Code's transcript (matching the
// Anthropic Messages API, where a tool_result is also role:"user"). A tool
// result carries `toolUseResult` and/or tool_result content blocks; a
// sidechain user record is the orchestrator's prompt *to* a subagent, not a
// person. Excluding both is what makes this the friction half of
// adoption-vs-friction (spec 0039 §8.1) rather than an inflated turn count.
function isHumanTurn(record) {
  if (record.type !== 'user' || record.isSidechain || record.isMeta) return false;
  if (record.toolUseResult !== undefined) return false;
  if (toolResultBlocks(record.message).length > 0) return false;
  return true;
}

function topN(counts, n) {
  return [...counts.entries()]
    .map(([tool, count]) => ({ tool, n: count }))
    .sort((a, b) => b.n - a.n || a.tool.localeCompare(b.tool))
    .slice(0, n);
}

// The deterministic digest itself (spec 0039 §3): counts, durations, tool
// names — never client data, never free text. `stageForTs(ms)` is an
// optional pure lookup (typically built from the telemetry journal's
// stage_start/stage_end intervals) used only to label which stage a retry
// loop or edit fell in; omitting it leaves `stage: null` rather than guessing.
function computeDigest(sessionFiles, { tailComplete = true, stageForTs = () => null } = {}) {
  if (!Array.isArray(sessionFiles) || sessionFiles.length === 0) {
    throw new Error('computeDigest requires at least one session file');
  }

  let ccVersion = null;
  let transcriptTurns = 0;
  let humanTurns = 0;
  let agentTurns = 0;
  let sidechainTurns = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let toolCalls = 0;
  let toolFailures = 0;
  const toolFailureCounts = new Map();
  const toolNameById = new Map();
  const editedFiles = new Set();
  let hookBlocks = 0;
  let hookErrors = 0;
  const retryLoops = [];
  const timestampsMs = [];

  let streakKey = null;
  let streakTool = null;
  let streakLen = 0;
  let streakStartTs = null;
  const flushStreak = () => {
    if (streakLen >= RETRY_LOOP_MIN_REPEATS) {
      retryLoops.push({ tool: streakTool, repeats: streakLen, stage: stageForTs(streakStartTs) });
    }
    streakKey = null;
    streakTool = null;
    streakLen = 0;
    streakStartTs = null;
  };

  for (const session of [...sessionFiles].sort((a, b) => (a.firstTs || 0) - (b.firstTs || 0))) {
    const { records } = readSessionRecords(session.path);
    for (const record of records) {
      if (typeof record.version === 'string') ccVersion = record.version;
      const tsMs = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
      if (Number.isFinite(tsMs)) timestampsMs.push(tsMs);

      if (record.type === 'assistant') {
        transcriptTurns += 1;
        if (record.isSidechain) sidechainTurns += 1;
        else agentTurns += 1;
        const usage = record.message && record.message.usage;
        if (usage) {
          inputTokens += usage.input_tokens || 0;
          outputTokens += usage.output_tokens || 0;
          cacheReadTokens += usage.cache_read_input_tokens || 0;
          cacheCreationTokens += usage.cache_creation_input_tokens || 0;
        }
        for (const block of toolUseBlocks(record.message)) {
          toolNameById.set(block.id, block.name);
          toolCalls += 1;
          const key = `${block.name}:${stableStringify(block.input)}`;
          if (key === streakKey) {
            streakLen += 1;
          } else {
            flushStreak();
            streakKey = key;
            streakTool = block.name;
            streakLen = 1;
            streakStartTs = Number.isFinite(tsMs) ? tsMs : streakStartTs;
          }
        }
        continue;
      }

      if (record.type === 'user') {
        if (isHumanTurn(record)) {
          transcriptTurns += 1;
          humanTurns += 1;
        }
        for (const result of toolResultBlocks(record.message)) {
          const name = toolNameById.get(result.tool_use_id) || 'unknown';
          if (result.is_error) {
            toolFailures += 1;
            toolFailureCounts.set(name, (toolFailureCounts.get(name) || 0) + 1);
            // A tool call whose result is an error breaks any retry streak it
            // was part of only if the NEXT call changes shape; a genuine retry
            // loop is agent-driven (repeated tool_use), so failures are
            // counted but do not themselves reset the streak tracker above.
          }
        }
        continue;
      }

      if (record.type === 'system') {
        if (Array.isArray(record.hookErrors)) hookErrors += record.hookErrors.length;
        if (record.preventedContinuation === true) hookBlocks += 1;
        continue;
      }

      if (record.type === 'file-history-snapshot' && record.isSnapshotUpdate === true) {
        const backups = record.snapshot && record.snapshot.trackedFileBackups;
        if (backups && typeof backups === 'object') {
          for (const filePath of Object.keys(backups)) editedFiles.add(filePath);
        }
      }
    }
  }
  flushStreak();

  timestampsMs.sort((a, b) => a - b);
  const wallMs = timestampsMs.length > 1 ? timestampsMs[timestampsMs.length - 1] - timestampsMs[0] : 0;
  let idleMs = 0;
  let longestGapMs = 0;
  for (let i = 1; i < timestampsMs.length; i += 1) {
    const gap = timestampsMs[i] - timestampsMs[i - 1];
    if (gap > longestGapMs) longestGapMs = gap;
    if (gap >= IDLE_GAP_MIN_MS) idleMs += gap;
  }
  const activeMs = Math.max(0, wallMs - idleMs);

  retryLoops.sort((a, b) => b.repeats - a.repeats);

  return {
    source: {
      sessions: sessionFiles.length,
      transcript_turns: transcriptTurns,
      cc_version: ccVersion,
      tail_complete: tailComplete,
    },
    cost: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: cacheReadTokens,
      cache_creation_input_tokens: cacheCreationTokens,
    },
    interaction: {
      human_turns: humanTurns,
      agent_turns: agentTurns,
      sidechain_turns: sidechainTurns,
    },
    time: {
      wall_ms: wallMs,
      active_ms: activeMs,
      idle_ms: idleMs,
      longest_gap_ms: longestGapMs,
    },
    tools: {
      calls: toolCalls,
      failures: toolFailures,
      top_failing: topN(toolFailureCounts, TOP_FAILING_MAX),
    },
    signals: {
      retry_loops: retryLoops.slice(0, RETRY_LOOPS_MAX),
      hook_blocks: hookBlocks,
      hook_errors: hookErrors,
      files_edited_mid_run: editedFiles.size,
    },
  };
}

module.exports = {
  RETRY_LOOP_MIN_REPEATS,
  IDLE_GAP_MIN_MS,
  escapeCwd,
  discoverRunSessions,
  computeDigest,
};
