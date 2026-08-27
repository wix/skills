import path from "node:path";
import { docsDir, ensureDir, normalizeUrl, readJson, resolveOutputDir, writeJson } from "./common.mjs";

export const FRONTEND_AUTOMATION_SCHEMA_VERSION = 1;

export async function resolveFrontendContext({ args }) {
  const handoffPath = args.handoff ? path.resolve(String(args.handoff)) : null;
  if (!handoffPath) {
    const sourceUrl = normalizeUrl(args._[0] || args.url).toString();
    const explicitUrls = parseExplicitUrls(args.urls, sourceUrl);
    return {
      mode: "standalone",
      handoffPath: null,
      handoff: null,
      sourceUrl,
      scope: String(args.scope || (explicitUrls.length ? "specific" : "home")),
      explicitUrls,
      outputDir: resolveOutputDir(sourceUrl, args.out),
      automationMode: "manual",
      autoApprove: false,
      faceliftRequested: args.facelift === true || args.facelift === "true" || args.facelift === "requested",
      frontendPhase: "build",
      selectedScopeSource: args.scope ? "cli" : explicitUrls.length ? "cli-explicit-urls" : "default",
    };
  }

  const handoff = await readJson(handoffPath);
  const sourceUrl = normalizeUrl(args._[0] || args.url || handoff?.source?.url).toString();
  const explicitUrls = normalizeExplicitUrls(handoff?.websiteScope?.explicitUrls, sourceUrl);
  const selectedScope = handoff?.websiteScope?.selectedScope || null;
  const scope = String(args.scope || (explicitUrls.length ? "specific" : selectedScope || "home"));
  const outputDir = args.out
    ? path.normalize(String(args.out))
    : handoff?.destination?.frontendProjectDir
      ? path.normalize(String(handoff.destination.frontendProjectDir))
      : resolveOutputDir(sourceUrl);
  const automationMode = handoff?.automationMode === "one_click" ? "one_click" : "manual";

  return {
    mode: "migration_phase",
    handoffPath,
    handoff,
    sourceUrl,
    scope,
    explicitUrls: explicitUrls.length && !args.urls ? explicitUrls : parseExplicitUrls(args.urls, sourceUrl),
    outputDir,
    automationMode,
    autoApprove: automationMode === "one_click",
    faceliftRequested: handoff?.facelift?.requested === true || args.facelift === true || args.facelift === "true" || args.facelift === "requested",
    frontendPhase: handoff?.frontendPhase?.allowedNow === "plan" ? "plan" : "build",
    selectedScopeSource: args.scope ? "cli" : selectedScope ? "handoff" : explicitUrls.length ? "handoff-explicit-urls" : "default",
  };
}

export function createFrontendAutomationState(context, timestamp = new Date().toISOString()) {
  const routineCheckpoint = context.autoApprove
    ? {
        status: "approved",
        decidedAt: timestamp,
        decidedBy: "agent",
        notes: "Migration phase 1-click mode inherited from website/handoff.json; routine frontend checkpoints auto-progress unless a real blocker stops the run.",
        artifactRefs: context.handoffPath ? [context.handoffPath] : [],
      }
    : {
        status: context.mode === "migration_phase" ? "pending" : "not_applicable",
        decidedAt: null,
        decidedBy: null,
        notes: context.mode === "migration_phase"
          ? "Routine frontend checkpoints stay manual unless website/handoff.json declares automationMode=one_click."
          : "Standalone mode does not inherit migration automation.",
        artifactRefs: context.handoffPath ? [context.handoffPath] : [],
      };

  return {
    schemaVersion: FRONTEND_AUTOMATION_SCHEMA_VERSION,
    generatedAt: timestamp,
    mode: context.mode,
    automationMode: context.automationMode,
    handoffPath: context.handoffPath,
    sourceUrl: context.sourceUrl,
    outputDir: context.outputDir,
    frontendPhase: context.frontendPhase,
    scope: {
      value: context.scope,
      explicitUrls: context.explicitUrls,
      selectedBy: context.selectedScopeSource,
    },
    checkpoints: {
      scopeSummary: {
        status: "not_started",
        decidedAt: null,
        decidedBy: null,
        notes: null,
        artifactRefs: [],
      },
      routineAutoProgress: routineCheckpoint,
      facelift: {
        requested: context.faceliftRequested === true,
        status: context.faceliftRequested ? "waiting_for_clone_acceptance" : "not_requested",
        decidedBy: context.faceliftRequested ? "user" : null,
        decidedAt: context.faceliftRequested ? timestamp : null,
        notes: context.faceliftRequested
          ? "Run only after the clone's normal gap-analysis and fix loop is accepted."
          : "UI/UX facelift was not explicitly requested.",
        artifactRefs: [],
      },
    },
  };
}

export function updateScopeSummaryCheckpoint(state, {
  status,
  discovery,
  artifactRefs = [],
  decidedBy = null,
  notes = null,
  timestamp = new Date().toISOString(),
}) {
  state.checkpoints.scopeSummary = {
    status,
    decidedAt: ["approved", "rejected"].includes(status) ? timestamp : null,
    decidedBy: ["approved", "rejected"].includes(status) ? decidedBy : null,
    notes,
    artifactRefs,
    summary: discovery ? {
      scope: discovery.scope,
      totalDiscovered: discovery.totalDiscovered,
      countsByArea: discovery.countsByArea,
      inScopeCount: discovery.inScopePages?.length || 0,
      preservedCount: discovery.preservedPages?.length || 0,
    } : undefined,
  };
  return state;
}

export async function writeFrontendAutomationState(outputDir, state) {
  const docs = docsDir(outputDir);
  await ensureDir(docs);
  const filePath = path.join(docs, "frontend-automation-state.json");
  await writeJson(filePath, state);
  return filePath;
}

export function renderScopeSummary(context, discovery) {
  const lines = [
    "# Scope Summary",
    "",
    `- Mode: ${context.mode}`,
    `- Automation: ${context.automationMode}`,
    `- Frontend phase: ${context.frontendPhase}`,
    `- Effective scope: ${discovery.scope}`,
    `- Total discovered URLs: ${discovery.totalDiscovered}`,
    `- In-scope implementation URLs: ${discovery.inScopePages?.length || 0}`,
    `- Preserved fallback URLs: ${discovery.preservedPages?.length || 0}`,
    "",
    "## Counts By Area",
  ];
  for (const [area, count] of Object.entries(discovery.countsByArea || {})) {
    lines.push(`- ${area}: ${count}`);
  }
  return `${lines.join("\n")}\n`;
}

function parseExplicitUrls(value, sourceUrl) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => new URL(item, sourceUrl).toString());
}

function normalizeExplicitUrls(urls, sourceUrl) {
  if (!Array.isArray(urls)) return [];
  return urls
    .map((item) => {
      try {
        return new URL(String(item), sourceUrl).toString();
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
