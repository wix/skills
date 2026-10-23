'use strict';

// Per-plugin view of coverage: one row per INSTALLED PLUGIN, projected from the capability
// rows classifyCoverage produced. A merchant asks about plugins, not capabilities, so this
// view exists — but it introduces no vocabulary of its own: rows
// carry the same five statuses the coverage rows do, and every row records what produced it so
// a wrong row traces back.
//
// The statuses are already customer-readable; STATUS_META only adds display order and the
// one-line explanation each group renders under.

const STATUS_META = {
  'requires-development': {
    label: 'Requires development',
    order: 1,
    blurb: 'Wix has no surface for this; someone has to build it first. A human-signed verdict — automation never concludes this on its own.',
  },
  pending: {
    label: 'Pending',
    order: 2,
    blurb: 'We do not know how to migrate this yet. Our open item, decided at the mapping review — never a limitation of the source or of Wix.',
  },
  // For manual-mapping: a complete, decided mapping, not a pending one — Wix can do this, but reaching
  // it is a runbook the merchant clicks through, not an API call our code makes. Ranked below
  // migration-planned only because merchant time is still owed, never because the decision is
  // less final; ranked above pending because, unlike pending, nothing here is undecided.
  'manual-mapping': {
    label: 'Manual mapping available',
    order: 3,
    blurb: 'Wix can do this. The mapping is decided — these are the exact steps you take yourself, no further review needed.',
  },
  'migration-planned': {
    label: 'Migration planned',
    order: 4,
    blurb: 'This comes across — via API into a native Wix entity, or via CMS as data keeping its original IDs.',
  },
  'no-need-to-migrate': {
    label: 'No need to migrate',
    order: 5,
    blurb: 'Nothing to move: Wix already does it, it was never data, or it is a setting you reconfigure once in Wix.',
  },
};

// Worst-first: the status a plugin shows is the most demanding one across its capability
// rows. A plugin that is half planned and half pending is a pending conversation.
const STATUS_PRECEDENCE = ['requires-development', 'pending', 'manual-mapping', 'migration-planned', 'no-need-to-migrate'];

function worstStatus(statuses) {
  for (const status of STATUS_PRECEDENCE) {
    if (statuses.includes(status)) return status;
  }
  return null;
}

function hintIndex(hintsFile) {
  const index = new Map();
  for (const hint of (hintsFile && hintsFile.hints) || []) {
    if (hint && hint.slug) index.set(hint.slug, hint);
  }
  return index;
}

function slugOf(pluginId) {
  return String(pluginId || '').split('/')[0];
}

/**
 * Build one row per installed plugin from the coverage rows. When the plugin list was
 * unavailable (no admin credential) there is no installed set to iterate, so rows come from
 * detections only — and that limitation is reported rather than hidden.
 */
function buildDispositionRows({
  detection = null,
  coverage = [],
  profiles = [],
  hints = null,
} = {}) {
  const hintsBySlug = hintIndex(hints);
  const profilesBySlug = new Map(profiles.map((profile) => [profile.plugin, profile]));
  const rows = [];

  // A capability can carry two rows — the recognized profile row and a derived proposal
  // (VERIFIED LIVE 2026-08-10: content.events held the TEC profile row plus a proposed row
  // from unrelated event-ish CPTs). A recognized plugin's view must reflect its own row, so
  // the recognized row wins the key; insertion order must not decide.
  const coverageByCapability = new Map();
  for (const row of coverage) {
    const existing = coverageByCapability.get(row.capability);
    if (!existing || (row.recognized && !existing.recognized)) coverageByCapability.set(row.capability, row);
  }
  const coverageByPlugin = new Map();
  for (const row of coverage) {
    for (const plugin of row.plugins || []) {
      const slug = slugOf(plugin) || plugin;
      if (!coverageByPlugin.has(slug)) coverageByPlugin.set(slug, []);
      coverageByPlugin.get(slug).push(row);
    }
  }

  // 1. Recognized plugins — the richest rows.
  for (const detected of detection?.detected || []) {
    const profile = profilesBySlug.get(detected.plugin);
    const capRows = detected.capabilities
      .map((capability) => coverageByCapability.get(capability))
      .filter(Boolean);
    const status = worstStatus(capRows.map((row) => row.status)) || 'pending';
    const plannedRows = capRows.filter((row) => row.status === 'migration-planned');
    const manualMappingRows = capRows.filter((row) => row.status === 'manual-mapping');

    rows.push({
      plugin: detected.plugin,
      displayName: detected.displayName || detected.plugin,
      version: detected.version,
      active: detected.active,
      does: profile?.does || describeFromCapabilities(detected.capabilities),
      status,
      via: plannedRows.length > 0
        ? Array.from(new Set(plannedRows.map((row) => row.via))).sort().join('+')
        : null,
      mappingConfidence: plannedRows.length > 0
        ? (plannedRows.every((row) => row.confidence === 'confirmed') ? 'confirmed' : 'proposed')
        : null,
      consequence: capRows.map((row) => row.userImpact).filter(Boolean).join(' ')
        || profile?.replacedBy
        || '',
      // The runbook to render inline when status is manual-mapping.
      // One plugin could in principle carry more than one manual-mapping capability; only the
      // first is rendered today, same simplification `via`/`mappingConfidence` above already
      // make for multi-capability plugins.
      manualSteps: manualMappingRows[0]?.manualSteps || null,
      // --- debugging basis ---
      recognized: true,
      inventoryBasis: detection.pluginListAvailable && detected.signals.includes('wp.v2.plugins')
        ? 'verified'
        : 'fingerprinted',
      statusBasis: capRows.length > 0
        ? Array.from(new Set(capRows.map((row) => row.basis))).sort().join('+')
        : 'profile',
      confidence: detected.confidence,
      signals: detected.signals,
      capabilities: detected.capabilities,
      channels: Array.from(new Set(detected.entities.map((entity) => entity.channel))).sort(),
      channelStatuses: Array.from(new Set(detected.entities.map((entity) => entity.channelStatus))).sort(),
      targetRefs: Array.from(new Set(capRows.flatMap((row) => row.targetRefs || []))).sort(),
      profileVersion: detected.profileVersion || null,
      blocked: capRows.flatMap((row) => row.blocked || []),
      blockers: capRows.flatMap((row) => (row.pitfalls || []).filter((pitfall) => pitfall.severity === 'blocker').map((pitfall) => pitfall.summary)),
    });
  }

  // 2. Installed but unrecognized — projected from the rows classifyCoverage already made
  // (attributed namespace/CPT rows, no-migration-needed list rows, or pending/cannot-tell).
  for (const installed of detection?.installedButUnprofiled || []) {
    const slug = slugOf(installed.plugin);
    const hint = hintsBySlug.get(slug);
    const capRows = coverageByPlugin.get(slug) || [];
    const status = worstStatus(capRows.map((row) => row.status)) || 'pending';
    const plannedRows = capRows.filter((row) => row.status === 'migration-planned');
    const noNeedRow = capRows.find((row) => row.status === 'no-need-to-migrate');

    rows.push({
      plugin: installed.plugin,
      displayName: installed.name || slug,
      version: installed.version,
      active: installed.active,
      does: hint?.does || '',
      status,
      via: plannedRows.length > 0
        ? Array.from(new Set(plannedRows.map((row) => row.via))).sort().join('+')
        : null,
      mappingConfidence: plannedRows.length > 0 ? 'proposed' : null,
      consequence: noNeedRow?.rationale
        || capRows.map((row) => row.userImpact).filter(Boolean).join(' ')
        || 'We could not identify migratable data for this plugin. If it holds data you need, tell us.',
      manualSteps: capRows.find((row) => row.status === 'manual-mapping')?.manualSteps || null,
      recognized: false,
      inventoryBasis: 'verified',
      statusBasis: capRows.length > 0
        ? Array.from(new Set(capRows.map((row) => row.basis))).sort().join('+')
        : 'unresolved',
      confidence: null,
      signals: [],
      capabilities: [],
      channels: [],
      channelStatuses: [],
      targetRefs: Array.from(new Set(capRows.flatMap((row) => row.targetRefs || []))).sort(),
      profileVersion: null,
      blocked: capRows.flatMap((row) => row.blocked || []),
      blockers: [],
    });
  }

  // 3. Fingerprinted — public evidence only, typically an unauthenticated run. Named
  // from the alias map, projected from the coverage rows classifyCoverage already produced.
  for (const print of detection?.fingerprinted || []) {
    // The fingerprinted-capability lookup and the plugin-slug lookup can surface the same
    // coverage row twice (a row attributed to this plugin also keyed under its own
    // fingerprint token) — dedupe by capability id or userImpact/blocked entries double up.
    const capRowsBySlug = new Map(
      [
        ...(coverageByCapability.has(`fingerprinted:${print.token}`) ? [coverageByCapability.get(`fingerprinted:${print.token}`)] : []),
        ...(coverageByPlugin.get(print.slug) || []),
      ].map((row) => [row.capability, row]),
    );
    const capRows = Array.from(capRowsBySlug.values());
    if (capRows.length === 0) continue;
    const status = worstStatus(capRows.map((row) => row.status)) || 'pending';
    const noNeedRow = capRows.find((row) => row.status === 'no-need-to-migrate');
    rows.push({
      plugin: print.slug,
      displayName: print.displayName || print.token,
      version: null,
      active: null,
      does: '',
      status,
      via: null,
      mappingConfidence: null,
      consequence: noNeedRow?.rationale
        || capRows.map((row) => row.userImpact).filter(Boolean).join(' '),
      manualSteps: capRows.find((row) => row.status === 'manual-mapping')?.manualSteps || null,
      recognized: false,
      inventoryBasis: 'fingerprinted',
      statusBasis: Array.from(new Set(capRows.map((row) => row.basis))).sort().join('+'),
      confidence: null,
      signals: print.evidence,
      capabilities: [],
      channels: [],
      channelStatuses: [],
      targetRefs: [],
      profileVersion: null,
      blocked: [],
      blockers: [],
    });
  }

  for (const row of rows) {
    row.prerequisite = row.status === 'migration-planned' && (row.via || '').includes('cms')
      ? CMS_PREREQUISITE
      : null;
  }

  return rows.sort((a, b) => {
    const da = STATUS_META[a.status]?.order ?? 99;
    const db = STATUS_META[b.status]?.order ?? 99;
    return da - db || a.displayName.localeCompare(b.displayName);
  });
}

// A CMS destination is not free: Wix Data must be installed first (otherwise item writes fail
// with WDE0110), and the collection itself has no verified writer yet, so creating it is manual
// setup. A row that says data comes across without saying that overstates how automatic it is.
const CMS_PREREQUISITE = 'Requires the Wix Data app installed, and the collection created as a setup step — collection creation is not automated yet.';

function describeFromCapabilities(capabilities) {
  if (!capabilities || capabilities.length === 0) return '';
  return `Provides ${capabilities.join(', ')}.`;
}

function summarizeDispositions(rows) {
  const byStatus = {};
  for (const row of rows) byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  return {
    plugins: rows.length,
    active: rows.filter((row) => row.active).length,
    byStatus,
    needsMigrationWork: rows.filter((row) => ['migration-planned', 'pending', 'requires-development'].includes(row.status)).length,
    // manual-mapping is neither: no pipeline/codegen work is owed (unlike needsMigrationWork
    // above), but the merchant does owe some action (unlike noWorkNeeded below).
    needsMerchantAction: rows.filter((row) => row.status === 'manual-mapping').length,
    noWorkNeeded: rows.filter((row) => row.status === 'no-need-to-migrate').length,
    unresolved: rows.filter((row) => row.statusBasis === 'unresolved' || row.status === 'pending').length,
    // The batched blocked-but-recoverable ask: rows that need something from the user.
    blocked: rows.filter((row) => (row.blocked || []).length > 0).length,
    // Rows that cannot land without a setup step first; the execution plan needs the count.
    needsWixData: rows.filter((row) => row.prerequisite).length,
  };
}

function escapeCell(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

function renderDispositionMarkdown(rows, { host = null, generatedAt = null, pluginListAvailable = true } = {}) {
  const summary = summarizeDispositions(rows);
  const lines = [];

  lines.push('# Plugin migration map');
  lines.push('');
  lines.push(`One row per installed plugin, and where each one lands in Wix.${host ? ` Source: \`${host}\`.` : ''}`);
  lines.push('');
  lines.push(`- Plugins installed: **${summary.plugins}** (${summary.active} active)`);
  lines.push(`- Need migration work: **${summary.needsMigrationWork}**`);
  lines.push(`- Need no migration at all: **${summary.noWorkNeeded}**`);
  if (summary.needsMerchantAction > 0) {
    lines.push(`- Steps you can do right now: **${summary.needsMerchantAction}**`);
  }
  if (summary.blocked > 0) {
    lines.push(`- Blocked on something only you can provide: **${summary.blocked}**`);
  }
  if (generatedAt) lines.push(`- Generated: \`${generatedAt}\``);
  lines.push('');

  if (!pluginListAvailable) {
    lines.push('> **The installed plugin list was unavailable** (`GET /wp/v2/plugins` needs an administrator credential).');
    lines.push('> Only plugins detectable from public signals appear below, so this list is incomplete.');
    lines.push('');
  }

  const blockedRows = rows.filter((row) => (row.blocked || []).length > 0);
  if (blockedRows.length > 0) {
    lines.push('## Needs something from you — asked once, each item skippable');
    lines.push('');
    lines.push('Fixing any of these and re-running includes the data; skipping one never changes the mapping decision.');
    lines.push('');
    for (const row of blockedRows) {
      for (const blocker of row.blocked) {
        lines.push(`- **${row.displayName}** — ${blocker.resolution}${blocker.declined ? ' *(declined)*' : ''}`);
      }
    }
    lines.push('');
  }

  const blockers = rows.filter((row) => row.blockers.length > 0);
  if (blockers.length > 0) {
    lines.push('## Decide these before committing to a date');
    lines.push('');
    for (const row of blockers) {
      for (const blocker of row.blockers) lines.push(`- **${row.displayName}** — ${blocker}`);
    }
    lines.push('');
  }

  const groups = Object.entries(STATUS_META)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([key, meta]) => [key, meta, rows.filter((row) => row.status === key)])
    .filter(([, , group]) => group.length > 0);

  for (const [key, meta, group] of groups) {
    lines.push(`## ${meta.label} — ${group.length}`);
    lines.push('');
    lines.push(`${meta.blurb}`);
    lines.push('');
    if (key === 'manual-mapping') {
      // Unlike every other group, the point here is the runbook itself, not a one-line
      // consequence — so render each plugin's full manualSteps.steps[] inline instead of collapsing it into a table cell.
      for (const row of group) {
        lines.push(`### ${row.displayName} (\`${row.plugin}\`)`);
        lines.push('');
        if (row.does) lines.push(`${row.does}`);
        const steps = row.manualSteps;
        if (steps?.prerequisite) lines.push(`**Before you start:** ${steps.prerequisite}`);
        if (steps?.steps?.length) {
          lines.push('');
          steps.steps.forEach((step, index) => {
            const outsideWix = step.actor === 'external' ? ' *(outside Wix)*' : '';
            lines.push(`${index + 1}. ${step.text}${outsideWix}`);
          });
        }
        if (steps?.mechanism) {
          lines.push('');
          lines.push(`_How it behaves once connected:_ ${steps.mechanism}`);
        }
        lines.push('');
      }
    } else {
      lines.push('| Plugin | What it does | What that means for this store | Status |');
      lines.push('| --- | --- | --- | --- |');
      for (const row of group) {
        const consequence = row.prerequisite
          ? `${row.consequence} ${row.prerequisite}`.trim()
          : row.consequence;
        lines.push(`| **${escapeCell(row.displayName)}**<br>\`${escapeCell(row.plugin)}\` | ${escapeCell(row.does)} | ${escapeCell(consequence)} | ${row.active ? 'active' : 'inactive'} · v${escapeCell(row.version)} |`);
      }
      lines.push('');
    }
  }

  lines.push('## Basis for each row (for debugging this run)');
  lines.push('');
  lines.push('`verified` inventory facts come from the site API. A `proposed` mapping is our **assessment** until the mapping review confirms it — never present a proposed row to a customer as fact.');
  lines.push('');
  lines.push('| Plugin | Status | Via | Mapping | Basis | Confidence | Channels | Targets | Profile |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    lines.push(`| \`${escapeCell(row.plugin)}\` | ${escapeCell(row.status)} | ${escapeCell(row.via || '-')} | ${escapeCell(row.mappingConfidence || '-')} | inv:${row.inventoryBasis} / status:${row.statusBasis} | ${escapeCell(row.confidence || '-')} | ${escapeCell(row.channels.join(', ') || '-')} | ${escapeCell(row.targetRefs.join(', ') || '-')} | ${escapeCell(row.profileVersion || '-')} |`);
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

module.exports = {
  STATUS_META,
  STATUS_PRECEDENCE,
  worstStatus,
  buildDispositionRows,
  summarizeDispositions,
  renderDispositionMarkdown,
  hintIndex,
};
