'use strict';

// Generic layout inference: how rows in a CSV group into entities, which
// columns belong to which entity, and which entities have to be synthesized
// from the distinct values of a column.
//
// Deterministic-first (AGENTS.md): when the signals are clear this module sets
// the pattern; when they are ambiguous it returns `pattern: 'unknown'` with
// `halt: true` and the ranked candidates, so discovery asks the user instead of
// guessing. A vendor overlay pins the layout for known vendors; this module is
// what runs for custom files and as the fallback when an overlay has drifted.

const { normalizeHeaderName, parseText } = require('./csv-parse.js');

const LAYOUT_SAMPLE_ROWS = 2000;
const MIN_LAYOUT_ROWS = 5;
const MIN_GROUPS = 3;
const SECTION_MAX_LEVELS = 6;
const SECTION_MIN_ROWS_PER_LEVEL = 3;
const COLUMN_SKEW = 0.7;
const LAYOUT_MARGIN = 0.15;
const LAYOUT_HALT_BELOW = 0.7;
const CHILD_SKEW = 0.8;
const PARENT_SKEW = 0.8;

const KNOWN_LEVEL_VOCAB = new Set([
  'simple', 'variable', 'variation', 'grouped', 'external',
  'product', 'variant', 'parent', 'child', 'item', 'sku', 'header', 'detail', 'line',
]);

const CATEGORY_COLUMN_NAMES = new Set([
  'category', 'categories', 'productcategory', 'producttype', 'collection',
  'collections', 'department', 'taxonomy', 'tags', 'tag',
]);

const DERIVED_AUTO_CONFIDENCE = 0.8;
const DERIVED_PROPOSE_CONFIDENCE = 0.5;
const HIERARCHY_SEP_MIN_RATE = 0.5;
const MULTI_VALUE_SEP_MIN_RATE = 0.3;
const MULTI_VALUE_DISTINCT_DROP = 0.7;
const MULTI_VALUE_MAX_TOKEN_LENGTH = 40;
const MULTI_VALUE_MAX_TOKENS = 12;

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function cellAt(row, index) {
  const value = row.values[index];
  return value === undefined || value === null ? '' : value;
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';
}

function columnIndex(header, name) {
  if (!name) {
    return -1;
  }
  const target = normalizeHeaderName(name);
  return header.findIndex((column) => normalizeHeaderName(column) === target);
}

// Per-column statistics every classifier below reads. One pass, head-sampled.
function profileColumns(header, rows) {
  return header.map((name, index) => {
    const values = rows.map((row) => cellAt(row, index));
    const nonBlank = values.filter((value) => !isBlank(value));
    const distinctAll = new Set(values);
    const distinctNonBlank = new Set(nonBlank);

    let runCount = 0;
    let previous = null;
    for (const value of values) {
      if (previous === null || value !== previous) {
        runCount += 1;
      }
      previous = value;
    }

    let blanksLead = false;
    for (const value of values) {
      if (isBlank(value)) {
        blanksLead = true;
        break;
      }
      if (!isBlank(value)) {
        break;
      }
    }

    const total = values.length || 1;
    return {
      name,
      index,
      total: values.length,
      nonBlankCount: nonBlank.length,
      blankCount: values.length - nonBlank.length,
      blankRate: (values.length - nonBlank.length) / total,
      distinct: distinctAll.size,
      distinctNonBlank: distinctNonBlank.size,
      distinctRatio: nonBlank.length === 0 ? 0 : distinctNonBlank.size / nonBlank.length,
      runCount,
      meanRunLength: runCount === 0 ? 0 : values.length / runCount,
      blanksLead,
      firstRowBlank: values.length > 0 && isBlank(values[0]),
      isIdLike: nonBlank.length === values.length && distinctNonBlank.size === values.length && values.length > 0,
      levels: distinctNonBlank.size <= SECTION_MAX_LEVELS ? [...distinctNonBlank] : null,
    };
  });
}

// Row indices at which a new group starts. Two candidate key columns that
// produce the SAME boundaries describe the same grouping — only the label is
// ambiguous, which is not a reason to halt.
function blankKeyBoundaries(rows, index) {
  const boundaries = [];
  rows.forEach((row, rowIndex) => {
    if (!isBlank(cellAt(row, index))) {
      boundaries.push(rowIndex);
    }
  });
  return boundaries;
}

function repeatKeyBoundaries(rows, index) {
  const boundaries = [];
  let previous = null;
  rows.forEach((row, rowIndex) => {
    const value = cellAt(row, index);
    if (previous === null || value !== previous) {
      boundaries.push(rowIndex);
    }
    previous = value;
  });
  return boundaries;
}

function blankKeyCandidates(stats, rows) {
  return stats
    .filter((column) => column.blankRate > 0
      && column.blankRate < 0.95
      && !column.firstRowBlank
      && column.distinctNonBlank === column.nonBlankCount
      && column.distinctNonBlank >= MIN_GROUPS
      && column.blankCount >= 1)
    .map((column) => ({
      column,
      boundaries: blankKeyBoundaries(rows, column.index),
      confidence: Math.min(0.95, 0.75 + 0.2 * Math.min(1, column.blankRate / 0.4)),
    }));
}

// A repeated key and a file merely SORTED by a categorical column look
// identical row-for-row. What separates them is a supporting parent column: in
// a real grouped file some other column is constant inside each run and differs
// between runs (the product name above its variant rows). A flat product list
// sorted by category has no such column — every other column varies inside the
// run — so it stays flat instead of inventing a parent/child split.
function hasSupportingParentColumn(stats, rows, keyIndex, boundaries) {
  const runs = boundaries.map((start, i) => {
    const end = i + 1 < boundaries.length ? boundaries[i + 1] : rows.length;
    return rows.slice(start, end);
  });

  return stats.some((column) => {
    if (column.index === keyIndex) {
      return false;
    }
    const runValues = [];
    for (const run of runs) {
      const values = new Set(run
        .map((row) => cellAt(row, column.index))
        .filter((value) => !isBlank(value)));
      if (values.size > 1) {
        return false;
      }
      if (values.size === 1) {
        runValues.push([...values][0]);
      }
    }
    return new Set(runValues).size > 1;
  });
}

function repeatKeyCandidates(stats, rows) {
  return stats
    .filter((column) => column.blankRate === 0
      && column.distinctRatio < 1
      && column.runCount === column.distinctNonBlank
      && column.distinctNonBlank >= MIN_GROUPS
      && column.meanRunLength >= 1.5
      && hasSupportingParentColumn(stats, rows, column.index, repeatKeyBoundaries(rows, column.index)))
    .map((column) => ({
      column,
      boundaries: repeatKeyBoundaries(rows, column.index),
      // Lower ceiling than blank-key on purpose: a file merely sorted by a
      // column is indistinguishable from one grouped by it.
      confidence: Math.min(0.9, 0.7 + 0.2 * Math.min(1, (column.meanRunLength - 1) / 2)),
    }));
}

// A low-cardinality column is only a section discriminator if the row kinds it
// separates actually populate different columns. Without this test every
// Published / Tax class column is a false positive.
function sectionSkew(stats, rows, discriminator) {
  const partitions = new Map();
  rows.forEach((row) => {
    const level = cellAt(row, discriminator.index);
    if (!partitions.has(level)) {
      partitions.set(level, []);
    }
    partitions.get(level).push(row);
  });
  if (partitions.size < 2) {
    return { maxSkew: 0, skewColumn: null };
  }

  let maxSkew = 0;
  let skewColumn = null;
  for (const column of stats) {
    if (column.index === discriminator.index) {
      continue;
    }
    const rates = [...partitions.values()].map((partitionRows) => {
      const blanks = partitionRows.filter((row) => isBlank(cellAt(row, column.index))).length;
      return blanks / (partitionRows.length || 1);
    });
    const skew = Math.max(...rates) - Math.min(...rates);
    if (skew > maxSkew) {
      maxSkew = skew;
      skewColumn = column.name;
    }
  }
  return { maxSkew, skewColumn };
}

function sectionedCandidates(stats, rows) {
  return stats
    .filter((column) => column.blankRate < 0.05
      && column.distinctNonBlank >= 2
      && column.distinctNonBlank <= SECTION_MAX_LEVELS
      && column.nonBlankCount / column.distinctNonBlank >= SECTION_MIN_ROWS_PER_LEVEL)
    .map((column) => {
      const { maxSkew, skewColumn } = sectionSkew(stats, rows, column);
      const vocabBonus = column.levels
        && column.levels.every((level) => KNOWN_LEVEL_VOCAB.has(normalizeHeaderName(level)))
        ? 0.1
        : 0;
      return {
        column,
        maxSkew,
        skewColumn,
        vocabBonus,
        confidence: maxSkew < COLUMN_SKEW
          ? 0
          : Math.min(0.95, 0.7 + (0.15 * (maxSkew - COLUMN_SKEW)) / 0.3 + vocabBonus),
      };
    })
    .filter((candidate) => candidate.confidence > 0);
}

// In a sectioned file, "blank" columns are blank because those ROWS are a
// different kind, not because they continue a group above. When a column's
// blankness is a pure function of the discriminator value, the blank-key
// reading is already explained by the sectioning and must not compete with it —
// otherwise every WooCommerce export looks ambiguous.
function blankKeyExplainedBySection(rows, keyIndex, discriminatorIndex) {
  const byLevel = new Map();
  for (const row of rows) {
    const level = cellAt(row, discriminatorIndex);
    const blank = isBlank(cellAt(row, keyIndex));
    if (!byLevel.has(level)) {
      byLevel.set(level, new Set());
    }
    byLevel.get(level).add(blank);
  }
  return [...byLevel.values()].every((observed) => observed.size === 1);
}

function pickGroupCandidate(candidates) {
  if (candidates.length === 0) {
    return { picked: null, equivalents: [], ambiguous: false };
  }
  const signatures = new Map();
  for (const candidate of candidates) {
    const signature = candidate.boundaries.join(',');
    if (!signatures.has(signature)) {
      signatures.set(signature, []);
    }
    signatures.get(signature).push(candidate);
  }
  if (signatures.size > 1) {
    return { picked: null, equivalents: [], ambiguous: true };
  }
  const [group] = [...signatures.values()];
  const ordered = [...group].sort((a, b) => a.column.index - b.column.index);
  return {
    picked: ordered[0],
    equivalents: ordered.slice(1).map((candidate) => candidate.column.name),
    ambiguous: false,
  };
}

function unknownLayout(evidence, confidence, candidates) {
  return {
    pattern: 'unknown',
    confidence: Math.min(0.5, confidence),
    halt: true,
    evidence,
    groupKey: null,
    continuation: null,
    discriminatorColumn: null,
    levels: null,
    childLevels: [],
    parentRefColumn: null,
    parentEntity: 'record',
    childEntity: null,
    candidates,
    layoutConflicts: [],
    source: 'inferred',
  };
}

function classifyLayout(header, rows, { overlayLayout = null, sampleRows = LAYOUT_SAMPLE_ROWS } = {}) {
  const sample = rows.slice(0, sampleRows);

  if (overlayLayout) {
    const applied = applyOverlayLayout(overlayLayout, header, sample);
    if (applied) {
      return applied;
    }
  }

  const evidence = [`sampledRows=${sample.length}`];
  if (sample.length < MIN_LAYOUT_ROWS) {
    evidence.push(`fewer than MIN_LAYOUT_ROWS=${MIN_LAYOUT_ROWS} data rows; not enough signal to classify`);
    return unknownLayout(evidence, 0.3, []);
  }

  const stats = profileColumns(header, sample);
  const sectioned = sectionedCandidates(stats, sample)
    .sort((a, b) => b.confidence - a.confidence || a.column.index - b.column.index);

  let rawBlankKey = blankKeyCandidates(stats, sample);
  if (sectioned.length > 0) {
    const discriminator = sectioned[0].column;
    const unexplained = rawBlankKey.filter((candidate) => !blankKeyExplainedBySection(sample, candidate.column.index, discriminator.index));
    if (unexplained.length < rawBlankKey.length) {
      evidence.push(`${rawBlankKey.length - unexplained.length} blank-key candidate(s) are explained by the "${discriminator.name}" sections, not by continuation rows`);
    }
    rawBlankKey = unexplained;
  }

  const blankKey = pickGroupCandidate(rawBlankKey);
  const repeatKey = pickGroupCandidate(repeatKeyCandidates(stats, sample));

  const candidates = [];
  if (blankKey.picked) {
    candidates.push({
      pattern: 'grouped-by-key',
      continuation: 'blank-key',
      groupKey: blankKey.picked.column.name,
      equivalentGroupKeys: blankKey.equivalents,
      confidence: blankKey.picked.confidence,
      groupCount: blankKey.picked.boundaries.length,
    });
  }
  if (repeatKey.picked) {
    candidates.push({
      pattern: 'grouped-by-key',
      continuation: 'repeat-key',
      groupKey: repeatKey.picked.column.name,
      equivalentGroupKeys: repeatKey.equivalents,
      confidence: repeatKey.picked.confidence,
      groupCount: repeatKey.picked.boundaries.length,
    });
  }
  if (sectioned.length > 0) {
    candidates.push({
      pattern: 'sectioned',
      discriminatorColumn: sectioned[0].column.name,
      levels: sectioned[0].column.levels,
      confidence: sectioned[0].confidence,
      skewColumn: sectioned[0].skewColumn,
    });
  }

  if (blankKey.ambiguous) {
    evidence.push('several blank-key candidates describe DIFFERENT groupings; refusing to pick one');
    return unknownLayout(evidence, 0.5, candidates);
  }
  if (repeatKey.ambiguous) {
    evidence.push('several repeat-key candidates describe DIFFERENT groupings; refusing to pick one');
    return unknownLayout(evidence, 0.5, candidates);
  }

  if (candidates.length === 0) {
    const idColumn = stats.find((column) => column.isIdLike);
    evidence.push(idColumn
      ? `no grouping signal; "${idColumn.name}" is unique and never blank`
      : 'no grouping signal and no unique id column');
    return {
      pattern: 'flat',
      confidence: idColumn ? 0.95 : 0.8,
      halt: false,
      evidence,
      groupKey: null,
      continuation: null,
      discriminatorColumn: null,
      levels: null,
      childLevels: [],
      parentRefColumn: null,
      parentEntity: 'record',
      childEntity: null,
      primaryKey: idColumn ? idColumn.name : null,
      candidates,
      layoutConflicts: [],
      source: 'inferred',
    };
  }

  const ranked = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  if (runnerUp && runnerUp.confidence >= LAYOUT_HALT_BELOW && winner.confidence - runnerUp.confidence < LAYOUT_MARGIN) {
    evidence.push(`two layouts score within ${LAYOUT_MARGIN}: ${winner.pattern}/${winner.continuation || winner.discriminatorColumn} vs ${runnerUp.pattern}/${runnerUp.continuation || runnerUp.discriminatorColumn}`);
    return unknownLayout(evidence, winner.confidence, candidates);
  }

  if (winner.pattern === 'grouped-by-key') {
    evidence.push(`grouped by "${winner.groupKey}" (${winner.continuation}); ${winner.groupCount} groups in the sample`);
    if (winner.equivalentGroupKeys.length > 0) {
      evidence.push(`same grouping is described by: ${winner.equivalentGroupKeys.join(', ')}`);
    }
  } else {
    evidence.push(`sectioned on "${winner.discriminatorColumn}" (levels: ${(winner.levels || []).join(', ')}); population skew found on "${winner.skewColumn}"`);
  }

  return {
    pattern: winner.pattern,
    confidence: winner.confidence,
    halt: false,
    evidence,
    groupKey: winner.groupKey || null,
    equivalentGroupKeys: winner.equivalentGroupKeys || [],
    continuation: winner.continuation || null,
    discriminatorColumn: winner.discriminatorColumn || null,
    levels: winner.levels || null,
    // Which levels are children cannot be inferred from a custom file; the user
    // or an overlay decides. Recorded as unresolved rather than guessed.
    childLevels: [],
    parentRefColumn: null,
    parentEntity: 'record',
    childEntity: winner.pattern === 'grouped-by-key' ? 'child' : null,
    candidates,
    layoutConflicts: [],
    source: 'inferred',
  };
}

// The layout an overlay declares, materialized against this file's header.
function pinnedLayout(overlayLayout, header, rows, { confidence, source, evidence, layoutConflicts = [] }) {
  const parentRefColumn = overlayLayout.parentRefColumn && columnIndex(header, overlayLayout.parentRefColumn) === -1
    ? null
    : overlayLayout.parentRefColumn || null;

  return {
    pattern: overlayLayout.pattern,
    confidence,
    halt: false,
    evidence,
    groupKey: overlayLayout.groupKey || null,
    equivalentGroupKeys: [],
    continuation: overlayLayout.continuation || null,
    discriminatorColumn: overlayLayout.discriminatorColumn || null,
    levels: overlayLayout.discriminatorColumn
      ? [...new Set(rows.map((row) => cellAt(row, columnIndex(header, overlayLayout.discriminatorColumn))).filter((value) => !isBlank(value)))]
      : null,
    childLevels: overlayLayout.childLevels || [],
    parentRefColumn,
    parentEntity: overlayLayout.parentEntity || 'record',
    childEntity: overlayLayout.childEntity || (overlayLayout.pattern === 'grouped-by-key' ? 'child' : null),
    columnGroups: overlayLayout.columnGroups || [],
    candidates: [],
    layoutConflicts,
    source,
  };
}

// A pinned `continuation` is a CLAIM ABOUT THE ROWS, not a fact about the vendor,
// and real exports vary: some Shopify files blank the Handle on continuation rows
// while others repeat it on every row. When the claim is false nothing errors —
// grouping silently collapses and each row becomes its own product — so the mode
// is checked against the sample before it is trusted.
//
// The check deliberately fires only when the two modes would group DIFFERENTLY.
// A file with one row per group (every key present, none repeated) is described
// equally well by either mode, and flagging it would report drift that has no
// consequence.
function verifyOverlayContinuation(overlayLayout, header, rows) {
  if (overlayLayout.pattern !== 'grouped-by-key'
    || (overlayLayout.continuation !== 'blank-key' && overlayLayout.continuation !== 'repeat-key')) {
    return { ok: true };
  }
  const keyIndex = columnIndex(header, overlayLayout.groupKey);
  if (keyIndex === -1 || rows.length === 0) {
    return { ok: true };
  }

  const blankBoundaries = blankKeyBoundaries(rows, keyIndex);
  const repeatBoundaries = repeatKeyBoundaries(rows, keyIndex);
  if (blankBoundaries.join(',') === repeatBoundaries.join(',')) {
    return { ok: true };
  }

  const declared = overlayLayout.continuation;
  const blankKeyRows = rows.filter((row) => isBlank(cellAt(row, keyIndex))).length;

  if (declared === 'blank-key' && blankKeyRows === 0) {
    return {
      ok: false,
      declared,
      observed: 'repeat-key',
      evidence: `overlay-continuation-mismatch: the overlay pins continuation="blank-key" but "${overlayLayout.groupKey}" is never blank in ${rows.length} sampled row(s); reading it as blank-key yields ${blankBoundaries.length} groups where the repeated key yields ${repeatBoundaries.length}`,
    };
  }
  // The mirror case: repeat-key grouping cannot start a group on a blank key, so
  // a blank one lands on whichever group precedes it.
  if (declared === 'repeat-key' && blankKeyRows > 0) {
    return {
      ok: false,
      declared,
      observed: 'blank-key',
      evidence: `overlay-continuation-mismatch: the overlay pins continuation="repeat-key" but "${overlayLayout.groupKey}" is blank on ${blankKeyRows} of ${rows.length} sampled row(s); reading it as repeat-key yields ${repeatBoundaries.length} groups where blank-key yields ${blankBoundaries.length}`,
    };
  }

  return { ok: true };
}

// An overlay pins the layout only as far as this file's rows corroborate it. Two
// things are checked: that its declared columns are actually in the header, and
// that its declared continuation mode is the one the rows exhibit. Either way a
// failed check falls back to inference and says so — the drift backstop the spec
// requires, and what "advisory, never authoritative" means for layout.
function applyOverlayLayout(overlayLayout, header, rows) {
  const mismatches = [];
  const conflicts = [];
  if (overlayLayout.groupKey && columnIndex(header, overlayLayout.groupKey) === -1) {
    mismatches.push(`overlay-groupkey-missing: "${overlayLayout.groupKey}" is not in the header`);
    conflicts.push({
      kind: 'overlay-groupkey-missing',
      overlayGroupKey: overlayLayout.groupKey,
      resolution: 'fell back to the generic classifier',
    });
  }
  if (overlayLayout.discriminatorColumn && columnIndex(header, overlayLayout.discriminatorColumn) === -1) {
    mismatches.push(`overlay-discriminator-missing: "${overlayLayout.discriminatorColumn}" is not in the header`);
    conflicts.push({
      kind: 'overlay-discriminator-missing',
      overlayDiscriminatorColumn: overlayLayout.discriminatorColumn,
      resolution: 'fell back to the generic classifier',
    });
  }
  if (mismatches.length > 0) {
    const inferred = classifyLayout(header, rows, { overlayLayout: null });
    return {
      ...inferred,
      source: 'inferred-after-overlay-mismatch',
      evidence: [...mismatches, ...inferred.evidence],
      layoutConflicts: conflicts,
    };
  }

  const continuation = verifyOverlayContinuation(overlayLayout, header, rows);
  if (!continuation.ok) {
    const inferred = classifyLayout(header, rows, { overlayLayout: null });
    // Which COLUMN groups the rows is the part vendors do not change, and the
    // overlay has just been confirmed to name a column this file has. So the
    // classifier is consulted about the disputed field only: a candidate naming
    // the same key column corroborates the observed mode even when the
    // classifier as a whole halted, because its halt is about *picking* a key.
    const corroborating = (inferred.candidates || []).find((candidate) => candidate.pattern === 'grouped-by-key'
      && candidate.groupKey
      && normalizeHeaderName(candidate.groupKey) === normalizeHeaderName(overlayLayout.groupKey)
      && candidate.continuation === continuation.observed);
    const conflict = {
      kind: 'overlay-continuation-mismatch',
      groupKey: overlayLayout.groupKey,
      overlayContinuation: continuation.declared,
      observedContinuation: continuation.observed,
      corroboratedBy: corroborating ? 'generic-classifier-candidate' : null,
      resolution: corroborating
        ? `kept the overlay's grouping and corrected continuation to "${continuation.observed}"`
        : 'fell back to the generic classifier',
    };

    if (corroborating) {
      return pinnedLayout(
        { ...overlayLayout, continuation: continuation.observed },
        header,
        rows,
        {
          confidence: corroborating.confidence,
          source: 'overlay-continuation-corrected',
          evidence: [
            continuation.evidence,
            `the generic classifier independently reads "${overlayLayout.groupKey}" as ${continuation.observed} with ${corroborating.groupCount} group(s) in the sample; continuation corrected to "${continuation.observed}" and the rest of the overlay kept`,
          ],
          layoutConflicts: [conflict],
        },
      );
    }

    // The rows contradict the declared mode AND the classifier finds no grouping
    // on the declared key. Nothing here is trustworthy enough to pin.
    return {
      ...inferred,
      source: 'inferred-after-overlay-mismatch',
      evidence: [
        continuation.evidence,
        `no generic candidate groups on "${overlayLayout.groupKey}" as ${continuation.observed} either, so the whole overlay layout was dropped`,
        ...inferred.evidence,
      ],
      layoutConflicts: [conflict],
    };
  }

  return pinnedLayout(overlayLayout, header, rows, {
    confidence: 1,
    source: 'overlay',
    evidence: [
      `layout pinned by the vendor overlay (${overlayLayout.pattern})`,
      ...(overlayLayout.pattern === 'grouped-by-key' && overlayLayout.continuation
        ? [`continuation="${overlayLayout.continuation}" verified against ${rows.length} sampled row(s)`]
        : []),
    ],
  });
}

// Materialize the row groups the layout describes. Every consumer (column-role
// derivation, derived entities, the generated reader) replays grouping through
// this one function so they cannot disagree.
function buildGroups(header, rows, layout) {
  if (layout.pattern === 'grouped-by-key') {
    const keyIndex = columnIndex(header, layout.groupKey);
    if (keyIndex === -1) {
      return [];
    }
    const groups = [];
    let current = null;
    let previousKey = null;
    rows.forEach((row, rowIndex) => {
      const value = cellAt(row, keyIndex);
      const startsGroup = layout.continuation === 'blank-key'
        ? !isBlank(value)
        : value !== previousKey;
      if (startsGroup || current === null) {
        current = { key: value, headIndex: rowIndex, rows: [], childRows: [] };
        groups.push(current);
      }
      current.rows.push({ row, rowIndex });
      if (rowIndex !== current.headIndex) {
        current.childRows.push({ row, rowIndex });
      }
      previousKey = value;
    });
    return groups;
  }

  if (layout.pattern === 'sectioned') {
    const discriminatorIndex = columnIndex(header, layout.discriminatorColumn);
    const parentRefIndex = columnIndex(header, layout.parentRefColumn);
    const childLevels = new Set((layout.childLevels || []).map((level) => normalizeHeaderName(level)));
    const groups = [];
    const byKey = new Map();
    let current = null;

    rows.forEach((row, rowIndex) => {
      const level = normalizeHeaderName(cellAt(row, discriminatorIndex));
      const isChild = childLevels.has(level);
      if (!isChild) {
        current = { key: null, headIndex: rowIndex, rows: [{ row, rowIndex }], childRows: [], level };
        groups.push(current);
        if (parentRefIndex !== -1) {
          // Woo links a variation to its parent by id or SKU, so index the
          // parent row under every value a child might reference it by.
          for (const value of row.values) {
            if (!isBlank(value)) {
              byKey.set(String(value).trim(), current);
            }
          }
        }
        return;
      }
      let target = current;
      if (parentRefIndex !== -1) {
        const ref = String(cellAt(row, parentRefIndex)).trim().replace(/^id:/i, '');
        target = byKey.get(ref) || current;
      }
      if (!target) {
        // A child row before any parent row: keep it visible rather than dropping it.
        target = { key: null, headIndex: rowIndex, rows: [], childRows: [], orphan: true };
        groups.push(target);
      }
      target.rows.push({ row, rowIndex });
      target.childRows.push({ row, rowIndex });
    });
    return groups;
  }

  return rows.map((row, rowIndex) => ({ key: null, headIndex: rowIndex, rows: [{ row, rowIndex }], childRows: [] }));
}

function matchesColumnGroup(columnName, group) {
  const normalized = normalizeHeaderName(columnName);
  for (const exact of group.columns || []) {
    if (normalizeHeaderName(exact) === normalized) {
      return true;
    }
  }
  for (const prefix of group.prefixes || []) {
    const normalizedPrefix = normalizeHeaderName(prefix);
    if (normalizedPrefix && normalized.startsWith(normalizedPrefix)) {
      return true;
    }
  }
  return false;
}

// Which entity does each column belong to?
//
// The naive rule ("child columns are the ones populated on continuation rows")
// is wrong for the most important case: a Shopify product's FIRST variant lives
// on the group head row, and a single-variant product has no continuation rows
// at all. The reliable generic signal is within-group VARIANCE, plus the mirror
// rule that a column blank on every continuation row is a parent column.
function deriveColumnRoles(header, rows, layout, { columnGroups = [] } = {}) {
  const groups = buildGroups(header, rows, layout);
  const multiRowGroups = groups.filter((group) => group.rows.length > 1);

  const parentColumns = [];
  const childColumns = [];
  const ambiguousColumns = [];
  const byEntity = {};
  const layoutConflicts = [];
  const overlayGroups = columnGroups.length > 0 ? columnGroups : (layout.columnGroups || []);

  const parentEntity = layout.parentEntity || 'record';
  const childEntity = layout.childEntity || 'child';
  byEntity[parentEntity] = [];

  header.forEach((name, index) => {
    const overlayGroup = overlayGroups.find((group) => matchesColumnGroup(name, group));

    let derivedRole = 'ambiguous';
    if (multiRowGroups.length === 0) {
      derivedRole = 'parent';
    } else {
      let varying = 0;
      let constant = 0;
      let blankOnEveryContinuation = 0;
      let populatedOnHead = 0;

      for (const group of multiRowGroups) {
        const groupValues = group.rows.map((entry) => cellAt(entry.row, index));
        const nonBlank = groupValues.filter((value) => !isBlank(value));
        if (new Set(nonBlank).size > 1) {
          varying += 1;
        } else {
          constant += 1;
        }
        const continuationValues = group.childRows.map((entry) => cellAt(entry.row, index));
        if (continuationValues.length > 0 && continuationValues.every((value) => isBlank(value))) {
          blankOnEveryContinuation += 1;
        }
        if (!isBlank(cellAt(group.rows[0].row, index))) {
          populatedOnHead += 1;
        }
      }

      const total = multiRowGroups.length;
      if (blankOnEveryContinuation / total >= PARENT_SKEW && populatedOnHead / total >= PARENT_SKEW) {
        derivedRole = 'parent';
      } else if (varying / total >= CHILD_SKEW) {
        derivedRole = 'child';
      } else if (constant / total >= PARENT_SKEW && populatedOnHead / total >= PARENT_SKEW) {
        derivedRole = 'parent';
      }
    }

    // Overlay wins on bucketing (only a declaration can separate Shopify's
    // image columns from its variant columns); data wins on visibility, so a
    // disagreement is recorded rather than silently dropped.
    const entity = overlayGroup ? overlayGroup.entity : (derivedRole === 'child' ? childEntity : parentEntity);
    if (overlayGroup && derivedRole !== 'ambiguous') {
      const overlaySaysChild = overlayGroup.entity !== parentEntity;
      if (overlaySaysChild !== (derivedRole === 'child')) {
        layoutConflicts.push({
          column: name,
          overlayEntity: overlayGroup.entity,
          derivedRole,
          resolution: 'kept the overlay assignment',
        });
      }
    }

    if (!byEntity[entity]) {
      byEntity[entity] = [];
    }
    byEntity[entity].push(name);

    if (entity === parentEntity) {
      parentColumns.push(name);
    } else if (entity === childEntity) {
      childColumns.push(name);
    }
    if (derivedRole === 'ambiguous' && !overlayGroup) {
      ambiguousColumns.push(name);
    }
  });

  const collectionColumns = Object.entries(byEntity)
    .filter(([entity]) => entity !== parentEntity && entity !== childEntity)
    .flatMap(([, columns]) => columns);

  return {
    parentEntity,
    childEntity: childColumns.length > 0 ? childEntity : null,
    parentColumns,
    childColumns,
    collectionColumns,
    ambiguousColumns,
    byEntity,
    layoutConflicts,
    groupCount: groups.length,
  };
}

function splitMultiValue(cell, separator) {
  if (!separator) {
    return [String(cell)];
  }
  // Vendors escape a separator inside a value by quoting it within the cell
  // ("Home, Garden > Tools"), so the inner split has to be RFC-4180 aware too.
  const rows = parseText(String(cell), { delimiter: separator });
  return rows.flatMap((row) => row.values);
}

// Distinct values of a column become their own entity. This is how categories
// (and tags) arrive in every named vendor's export.
function deriveColumnValues(header, rows, descriptor, { layout = null } = {}) {
  const index = columnIndex(header, descriptor.fromColumn);
  if (index === -1) {
    return {
      entity: descriptor.entity,
      records: [],
      links: [],
      missingColumn: descriptor.fromColumn,
    };
  }

  const hierarchySeparator = descriptor.hierarchySeparator || null;
  const multiValueSeparator = descriptor.multiValueSeparator || null;
  const groups = layout ? buildGroups(header, rows, layout) : rows.map((row, rowIndex) => ({
    key: null,
    headIndex: rowIndex,
    rows: [{ row, rowIndex }],
    childRows: [],
  }));

  const seen = new Map();
  const links = [];

  for (const group of groups) {
    // Group heads only: a Woo variation row leaves Categories blank, and a
    // Shopify continuation row would double-count its product's categories.
    const headEntry = group.rows[0];
    if (!headEntry) {
      continue;
    }
    const cell = cellAt(headEntry.row, index);
    if (isBlank(cell)) {
      continue;
    }

    // Multi-value split FIRST, then hierarchy per element. The other order
    // turns "Clothing > Shirts, Sale" into a category named "Shirts, Sale".
    const values = splitMultiValue(cell, multiValueSeparator)
      .map((value) => value.trim())
      .filter((value) => value !== '');

    for (const value of values) {
      const segments = (hierarchySeparator ? value.split(hierarchySeparator) : [value])
        .map((segment) => segment.trim())
        .filter((segment) => segment !== '');
      if (segments.length === 0) {
        continue;
      }

      let leafId = null;
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const pathSegments = segments.slice(0, depth);
        const id = pathSegments.map(slug).join('/');
        if (!seen.has(id)) {
          seen.set(id, {
            id,
            name: pathSegments[depth - 1],
            path: pathSegments.join(hierarchySeparator ? ` ${hierarchySeparator} ` : '/'),
            depth,
            parentId: depth > 1 ? pathSegments.slice(0, depth - 1).map(slug).join('/') : null,
            sourceRows: 0,
          });
        }
        leafId = id;
      }
      seen.get(leafId).sourceRows += 1;
      // Leaf-only linking. Whether ancestors are also attached is a mapping
      // decision, carried as descriptor.linkPolicy.
      links.push({
        from: group.key !== null && group.key !== '' ? group.key : `row:${headEntry.rowIndex}`,
        to: leafId,
      });
    }
  }

  // Depth-ascending so a parent is always created before its child when the
  // import walks the extract in order.
  const records = [...seen.values()].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));

  return {
    entity: descriptor.entity,
    origin: {
      kind: 'column-values',
      column: descriptor.fromColumn,
      hierarchySeparator,
      multiValueSeparator,
      linkPolicy: descriptor.linkPolicy || 'leaf',
    },
    hierarchical: Boolean(descriptor.hierarchical),
    records,
    links,
    missingColumn: null,
  };
}

function looksLikeUrl(value) {
  return /^(https?:)?\/\//i.test(String(value).trim());
}

// `<p>Soft cotton tee</p>` contains '>' in every row and would otherwise look
// like a two-level hierarchy shared by every product.
function looksLikeMarkup(value) {
  return /<\/?[a-z!][^>]*>/i.test(String(value));
}

function separatorRate(values, separator) {
  if (values.length === 0) {
    return 0;
  }
  return values.filter((value) => value.includes(separator)).length / values.length;
}

function sharedAncestorCount(values, separator) {
  const ancestors = new Map();
  for (const value of values) {
    const segments = value.split(separator).map((segment) => segment.trim()).filter(Boolean);
    for (let depth = 1; depth < segments.length; depth += 1) {
      const key = segments.slice(0, depth).join('>');
      if (!ancestors.has(key)) {
        ancestors.set(key, new Set());
      }
      ancestors.get(key).add(value);
    }
  }
  return [...ancestors.values()].filter((paths) => paths.size >= 2).length;
}

// For custom files. Deliberately narrow: only '>' is auto-detected as a
// hierarchy separator ('/' matches every URL column), and a column is only
// auto-derived when its NAME says it is a taxonomy. Everything else is proposed
// to the user rather than silently turned into an entity.
function detectDerivedCandidates(header, rows, { profile = null } = {}) {
  if (profile && Array.isArray(profile.derived) && profile.derived.length > 0) {
    return profile.derived.map((descriptor) => ({
      ...descriptor,
      status: columnIndex(header, descriptor.fromColumn) === -1 ? 'missing-column' : 'overlay',
      confidence: 1,
      evidence: `declared by the ${profile.vendor} overlay`,
    }));
  }

  const candidates = [];
  header.forEach((name, index) => {
    const values = rows
      .map((row) => cellAt(row, index))
      .filter((value) => !isBlank(value))
      .map((value) => String(value).trim());
    if (values.length === 0 || values.some(looksLikeUrl) || values.some(looksLikeMarkup)) {
      return;
    }

    const nameHit = CATEGORY_COLUMN_NAMES.has(normalizeHeaderName(name));
    const hierarchyRate = separatorRate(values, '>');
    const sharedAncestors = hierarchyRate >= HIERARCHY_SEP_MIN_RATE ? sharedAncestorCount(values, '>') : 0;
    const hierarchical = hierarchyRate >= HIERARCHY_SEP_MIN_RATE && sharedAncestors >= 1;

    const commaRate = separatorRate(values, ',');
    let multiValue = false;
    let distinctDrop = false;
    if (commaRate >= MULTI_VALUE_SEP_MIN_RATE) {
      const tokens = values.flatMap((value) => value.split(',').map((token) => token.trim()).filter(Boolean));
      const meanTokenLength = tokens.reduce((sum, token) => sum + token.length, 0) / (tokens.length || 1);
      const maxTokensPerCell = Math.max(...values.map((value) => value.split(',').length));
      const distinctBefore = new Set(values).size;
      const distinctAfter = new Set(tokens).size;
      // A free-text column split on commas yields near-unique tokens; a real
      // multi-value column reuses a small vocabulary.
      distinctDrop = distinctAfter < distinctBefore * MULTI_VALUE_DISTINCT_DROP;
      multiValue = distinctDrop
        && meanTokenLength <= MULTI_VALUE_MAX_TOKEN_LENGTH
        && maxTokensPerCell <= MULTI_VALUE_MAX_TOKENS;
    }

    if (!nameHit && !hierarchical) {
      return;
    }

    const confidence = 0.6
      + (nameHit ? 0.2 : 0)
      + (sharedAncestors > 0 ? 0.15 : 0)
      + (distinctDrop ? 0.05 : 0);
    if (confidence < DERIVED_PROPOSE_CONFIDENCE) {
      return;
    }

    candidates.push({
      entity: normalizeHeaderName(name).replace(/ies$/, 'y').replace(/s$/, '') || 'derived',
      fromColumn: name,
      hierarchySeparator: hierarchical ? '>' : null,
      multiValueSeparator: multiValue ? ',' : null,
      hierarchical,
      linkPolicy: 'leaf',
      status: confidence >= DERIVED_AUTO_CONFIDENCE ? 'auto' : 'proposed',
      confidence: Number(confidence.toFixed(2)),
      evidence: `nameHit=${nameHit}; hierarchyRate=${hierarchyRate.toFixed(2)}; sharedAncestors=${sharedAncestors}; multiValue=${multiValue}`,
    });
  });

  return candidates;
}

module.exports = {
  LAYOUT_SAMPLE_ROWS,
  MIN_LAYOUT_ROWS,
  MIN_GROUPS,
  SECTION_MAX_LEVELS,
  COLUMN_SKEW,
  LAYOUT_MARGIN,
  CHILD_SKEW,
  PARENT_SKEW,
  CATEGORY_COLUMN_NAMES,
  DERIVED_AUTO_CONFIDENCE,
  slug,
  columnIndex,
  profileColumns,
  classifyLayout,
  applyOverlayLayout,
  verifyOverlayContinuation,
  buildGroups,
  deriveColumnRoles,
  deriveColumnValues,
  detectDerivedCandidates,
  splitMultiValue,
};
