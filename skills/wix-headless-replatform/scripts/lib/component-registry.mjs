import path from "node:path";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolveCapabilityBinding, validateComponentCapabilities } from "./component-capabilities.mjs";

export const REGISTRY_RUNTIME_CLASSES = new Set(["astro-native", "react-static", "react-island"]);

export async function loadApprovedRegistry(registryRoot = new URL("../../registry/", import.meta.url)) {
  const root = registryRoot instanceof URL ? registryRoot : path.resolve(registryRoot);
  const rootPath = root instanceof URL ? fileURLPath(root) : root;
  const read = async (relativePath) => JSON.parse(await readFile(root instanceof URL ? new URL(relativePath, root) : path.join(root, relativePath), "utf8"));
  const registry = await read("registry.json");
  const approvalsDir = root instanceof URL ? new URL("approvals/", root) : path.join(root, "approvals");
  const approvals = new Map();
  for (const file of await jsonFilesRecursive(approvalsDir)) {
    const approval = JSON.parse(await readFile(root instanceof URL ? new URL(`approvals/${file}`, root) : path.join(approvalsDir, file), "utf8"));
    if (approval.decision === "approved" && approval.revoked !== true) {
      approvals.set(`${approval.registryItemName}@${approval.registryItemRevision}`, approval);
    }
  }
  const items = [];
  const rejected = [];
  for (const item of registry.items || []) {
    if (!item.revision || !item.sourceHash) {
      rejected.push({ item: item.name, reason: "registry-entry-is-not-immutable" });
      continue;
    }
    const approval = approvals.get(`${item.name}@${item.revision}`);
    if (!approval) {
      rejected.push({ item: item.name, reason: "missing-human-approval" });
      continue;
    }
    if (!REGISTRY_RUNTIME_CLASSES.has(approval.runtimeClass)) {
      rejected.push({ item: item.name, reason: "invalid-runtime-class" });
      continue;
    }
    if (!approval.reviewer?.human || !approval.reviewer?.id) {
      rejected.push({ item: item.name, reason: "approval-is-not-attributed-to-a-human" });
      continue;
    }
    if (!approval.licenseRef || !approval.sourceHash) {
      rejected.push({ item: item.name, reason: "approval-evidence-incomplete" });
      continue;
    }
    if (approval.sourceHash !== item.sourceHash) {
      rejected.push({ item: item.name, reason: "approval-source-hash-mismatch" });
      continue;
    }
    if (!item.capabilitiesRef || !item.capabilitiesHash || !item.contractRef || !item.contractHash) {
      rejected.push({ item: item.name, reason: "runtime-contract-metadata-missing" });
      continue;
    }
    if (approval.capabilitiesRef !== item.capabilitiesRef || approval.capabilitiesHash !== item.capabilitiesHash
      || approval.contractRef !== item.contractRef || approval.contractHash !== item.contractHash) {
      rejected.push({ item: item.name, reason: "approval-runtime-contract-mismatch" });
      continue;
    }
    try {
      const capabilityBytes = await readFile(safeJoin(rootPath, item.capabilitiesRef, "capability manifest"));
      const capabilityHash = createHash("sha256").update(capabilityBytes).digest("hex");
      if (capabilityHash !== item.capabilitiesHash) {
        rejected.push({ item: item.name, reason: "capability-manifest-hash-mismatch" });
        continue;
      }
      const capabilities = JSON.parse(capabilityBytes);
      const validation = validateComponentCapabilities(capabilities, {
        name: item.name,
        revision: item.revision,
        contract: approval.contractKind,
      });
      if (!validation.ok) {
        rejected.push({ item: item.name, reason: "capability-manifest-invalid", details: validation.errors });
        continue;
      }
      const contractBytes = await readFile(safeJoin(rootPath, item.contractRef, "agent contract"));
      const contractHash = createHash("sha256").update(contractBytes).digest("hex");
      if (contractHash !== item.contractHash) {
        rejected.push({ item: item.name, reason: "agent-contract-hash-mismatch" });
        continue;
      }
      if (!contractBytes.toString("utf8").trim()) {
        rejected.push({ item: item.name, reason: "agent-contract-empty" });
        continue;
      }
      items.push({ ...item, approval, capabilities });
    } catch (error) {
      rejected.push({ item: item.name, reason: "capability-manifest-unreadable", details: [error.message] });
    }
  }
  return { registry: { ...registry, items }, rejected };
}

export function selectRegistryItem(contract, approvedRegistry) {
  const hardRequirements = new Set(contract.hardRequirements || []);
  const rejected = [...(approvedRegistry.rejected || [])];
  const candidates = [];
  for (const item of approvedRegistry.registry?.items || []) {
    const approval = item.approval;
    const reasons = [];
    if (approval.contractKind !== contract.kind) reasons.push("contract-kind-mismatch");
    if (contract.requiresClientRuntime && approval.runtimeClass === "react-static") reasons.push("interaction-requires-runtime-state");
    for (const requirement of hardRequirements) if (approval.qualityGates?.[requirement] !== true) reasons.push(`quality-gate:${requirement}`);
    const capability = resolveCapabilityBinding(item.capabilities, contract.capabilityRequirements || {});
    reasons.push(...capability.reasons);
    if (reasons.length) rejected.push({ item: `${item.name}@${item.revision}`, reason: reasons.join(",") });
    else candidates.push({ item, binding: capability.binding });
  }
  candidates.sort((a, b) => {
    const aDeps = Object.keys(a.item.dependencies || {}).length + (a.item.registryDependencies || []).length;
    const bDeps = Object.keys(b.item.dependencies || {}).length + (b.item.registryDependencies || []).length;
    return aDeps - bDeps || a.item.name.localeCompare(b.item.name);
  });
  if (!candidates.length) return { strategy: "bounded-custom", selected: null, rejected };
  const winner = candidates[0];
  return {
    strategy: "curated-registry",
    selected: {
      name: winner.item.name,
      type: winner.item.type,
      files: winner.item.files,
      runtimeClass: winner.item.approval.runtimeClass,
      sourceHash: winner.item.approval.sourceHash,
      approvalRef: winner.item.approval.approvalRef,
      revision: winner.item.revision,
      dependencies: winner.item.dependencies || {},
      capabilitiesRef: winner.item.capabilitiesRef,
      capabilitiesHash: winner.item.capabilitiesHash,
      contractRef: winner.item.contractRef,
      contractHash: winner.item.contractHash,
      binding: winner.binding,
    },
    rejected: [...rejected, ...candidates.slice(1).map(({ item }) => ({ item: `${item.name}@${item.revision}`, reason: "higher-adaptation-or-dependency-cost" }))],
  };
}

export async function installRegistrySelection({ selection, outputDir, registryRoot = new URL("../../registry/", import.meta.url) }) {
  if (!selection || selection.strategy !== "curated-registry" || !selection.selected) return { strategy: "bounded-custom", installed: [] };
  const root = registryRoot instanceof URL ? fileURLPath(registryRoot) : path.resolve(registryRoot);
  const destinationRoot = path.resolve(outputDir);
  const installed = [];
  for (const file of selection.selected.files || []) {
    if (!file.path || !file.target || !file.sha256) throw new Error(`Registry file metadata is incomplete for ${selection.selected.name}`);
    const source = safeJoin(root, file.path, "registry source");
    const destination = safeJoin(destinationRoot, file.target, "registry target");
    const sourceBytes = await readFile(source);
    const actualHash = createHash("sha256").update(sourceBytes).digest("hex");
    if (actualHash !== file.sha256) throw new Error(`Registry source hash mismatch for ${file.path}: expected ${file.sha256}, got ${actualHash}`);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    installed.push({ source: file.path, target: file.target, sha256: actualHash });
  }
  const dependencies = selection.selected.dependencies || {};
  if (Array.isArray(dependencies)) throw new Error(`Registry dependencies must be exact name/version pairs for ${selection.selected.name}`);
  for (const [name, version] of Object.entries(dependencies)) {
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(version))) throw new Error(`Registry dependency ${name} must use an exact version, got ${version}`);
  }
  if (Object.keys(dependencies).length) {
    const packagePath = path.join(destinationRoot, "package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    packageJson.dependencies = { ...(packageJson.dependencies || {}), ...dependencies };
    packageJson.dependencies = Object.fromEntries(Object.entries(packageJson.dependencies).sort(([a], [b]) => a.localeCompare(b)));
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }
  const astroConfiguration = selection.selected.runtimeClass?.startsWith("react-")
    ? await ensureAstroReactIntegration(destinationRoot)
    : { changed: false, reason: "not-required" };
  return {
    strategy: "curated-registry",
    item: selection.selected.name,
    revision: selection.selected.revision,
    sourceHash: selection.selected.sourceHash,
    capabilitiesRef: selection.selected.capabilitiesRef,
    capabilitiesHash: selection.selected.capabilitiesHash,
    contractRef: selection.selected.contractRef,
    contractHash: selection.selected.contractHash,
    binding: selection.selected.binding,
    approvalRef: selection.selected.approvalRef,
    installed,
    dependencies,
    astroConfiguration,
  };
}

async function ensureAstroReactIntegration(destinationRoot) {
  const configPath = path.join(destinationRoot, "astro.config.mjs");
  let source;
  try { source = await readFile(configPath, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") throw new Error("React registry installation requires an existing astro.config.mjs");
    throw error;
  }
  const reactImport = source.match(/import\s+([A-Za-z_$][\w$]*)\s+from\s+["']@astrojs\/react["']/);
  const reactIdentifier = reactImport?.[1] || "react";
  const hasImport = Boolean(reactImport);
  const hasIntegration = new RegExp(`integrations\\s*:\\s*\\[[^\\]]*\\b${reactIdentifier}\\s*\\(`, "s").test(source);
  if (hasImport && hasIntegration) return { changed: false, config: "astro.config.mjs" };
  if (!/defineConfig\s*\(\s*\{/.test(source)) {
    throw new Error("Cannot safely add the React integration: astro.config.mjs must export defineConfig({...})");
  }
  let next = source;
  if (!hasImport) next = `import react from "@astrojs/react";\n${next}`;
  if (!hasIntegration) {
    if (/integrations\s*:\s*\[/.test(next)) {
      next = next.replace(/integrations\s*:\s*\[/, (match) => `${match}${reactIdentifier}(), `);
    } else {
      next = next.replace(/defineConfig\s*\(\s*\{/, (match) => `${match}\n  integrations: [${reactIdentifier}()],`);
    }
  }
  await writeFile(configPath, next);
  return {
    changed: true,
    config: "astro.config.mjs",
    sha256: createHash("sha256").update(next).digest("hex"),
  };
}

async function jsonFilesRecursive(dir, prefix = "") {
  try {
    const entries = await readdir(dir instanceof URL ? dir : path.resolve(dir), { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile() && entry.name.endsWith(".json")) files.push(relative);
      if (entry.isDirectory()) {
        const child = dir instanceof URL ? new URL(`${entry.name}/`, dir) : path.join(dir, entry.name);
        files.push(...await jsonFilesRecursive(child, relative));
      }
    }
    return files.sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function safeJoin(root, relativePath, label) {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes("..")) throw new Error(`${label} must be a safe relative path: ${relativePath}`);
  const normalizedRoot = path.resolve(root);
  const target = path.resolve(normalizedRoot, relativePath);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${path.sep}`)) throw new Error(`${label} escapes its root: ${relativePath}`);
  return target;
}

function fileURLPath(value) {
  if (value.protocol !== "file:") throw new Error(`Registry URL must use file: ${value}`);
  return fileURLToPath(value);
}
