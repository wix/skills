'use strict';

// A stage agent asked to hold the run (`orchestration-state.js transition --status blocked`) inside
// a supervised run. Only an operator may hold a run, so the hold is refused: the reason becomes a
// toolkit gap (execution/toolkit-gaps.json, source `agent-hold`, shown in the completion report),
// and a hand-back it names (resumeFrom.nextResource, e.g. codegen) still routes, stamped with its
// time like a recorded stop (orchestration-router importRepairSignals). The run goes on.

const { readToolkitGaps, recordToolkitGaps, GAPS_PATH } = require('./toolkit-gaps.js');

const SOURCE = 'agent-hold';

function recordRefusedHold(projectDir, resumeFrom, { runId = null, at = new Date().toISOString() } = {}) {
  const reason = resumeFrom && typeof resumeFrom === 'object' && !Array.isArray(resumeFrom) ? resumeFrom : null;
  const kept = readToolkitGaps(projectDir).filter((row) => row.source === SOURCE).map(({ step, file, why, kind }) => ({ step, file, why, kind }));
  const evidence = Array.isArray(reason?.evidence) ? reason.evidence.filter((e) => typeof e === 'string') : [];
  const row = {
    kind: 'override',
    step: `agent hold refused: ${reason?.reason || 'no reason given'}`,
    file: evidence[0] || reason?.nextResource || 'orchestration/run.json',
    why: `${String(reason?.detail || reason?.reason || 'an agent asked to hold the run').slice(0, 600)} (run ${runId || 'unknown'}, ${at}); only an operator may hold a run, so the run went on`,
  };
  recordToolkitGaps(projectDir, SOURCE, [...kept, row]);
  return { recorded: GAPS_PATH, resumeFrom: reason ? { ...reason, recordedAt: reason.recordedAt || at } : null };
}

module.exports = { SOURCE, recordRefusedHold };
