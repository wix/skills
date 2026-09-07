#!/usr/bin/env node
import path from "node:path";
import { parseArgs, readJson, writeJson, writeText } from "./lib/common.mjs";
import { verifyFrozenManifest } from "./lib/extraction-contract.mjs";
import { installRegistrySelection } from "./lib/component-registry.mjs";
import { inspectContentObject, removeContaminatedContent } from "./lib/content-boundary.mjs";

const safe = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plain = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export async function buildExtractedHomepage({ outputDir }) {
  const docs = path.join(outputDir, "docs", "site-clone");
  const latest = await readJson(path.join(docs, "extraction", "latest.json"));
  const extractionDir = path.join(docs, "extraction", latest.captureId);
  const integrity = await verifyFrozenManifest(extractionDir);
  if (!integrity.ok) throw new Error(`Frozen extraction integrity failed: ${integrity.failures.join("; ")}`);
  if (integrity.manifest.manifestHash !== latest.manifestHash) throw new Error("Latest extraction pointer does not match the frozen manifest hash");
  const index = await readJson(path.join(extractionDir, "spec-index.json"));
  const specs = new Map();
  for (const [id, relativePath] of Object.entries(index)) specs.set(id, await readJson(path.join(extractionDir, relativePath)));
  const plan = await readJson(path.join(docs, "build", "build-plan.json"));
  if (plan.manifestHash !== integrity.manifest.manifestHash) throw new Error("Build plan is stale for the current frozen manifest");
  const componentSelection = await readJson(path.join(docs, "build", "component-selection.json"));
  if (componentSelection.manifestHash !== plan.manifestHash) throw new Error("Component selection is stale for the current frozen manifest");
  const registryInstallations = [];
  for (const selection of componentSelection.selections || []) {
    if (selection.strategy !== "curated-registry") continue;
    registryInstallations.push({ unitId: selection.unitId, ...(await installRegistrySelection({ selection, outputDir })) });
  }
  await writeJson(path.join(docs, "build", "registry-installation.json"), {
    schemaVersion: plan.schemaVersion,
    manifestHash: plan.manifestHash,
    installations: registryInstallations,
  });
  const selectionByUnit = new Map((componentSelection.selections || []).map((selection) => [selection.unitId, selection]));
  const registryImports = registryComponentImports(componentSelection.selections || []);

  const metadata = specs.get("metadata:home")?.document || {};
  const foundation = specs.get("foundation:home") || {};
  const chrome = removeContaminatedContent(specs.get("shared-chrome:home") || {});
  const sections = [...specs.values()].filter((spec) => spec.kind === "unit" && spec.unitKind === "section").sort((a, b) => a.order - b.order);
  const resolution = await readJson(path.join(extractionDir, "page-resolution.spec.json"));
  const title = plain(metadata.title || metadata.openGraph?.["og:site_name"] || new URL(resolution.source.resolvedUrl).hostname);
  const description = plain(metadata.description || "");
  const logo = chrome.visualAssets?.logos?.find((asset) => asset.usages?.some((usage) => /header/.test(usage.context))) || chrome.visualAssets?.logos?.[0];
  const logoPath = assetPath(logo);
  const navigation = chrome.header?.navigation || chrome.header?.header?.navigation || [];
  const sectionMarkup = sections.map((section) => renderSection(section, specs, selectionByUnit, registryImports.symbols)).join("\n    ");
  const navMarkup = navigation.map((item) => renderNavItem(item)).join("");
  const fontCss = renderFontFaces(foundation.fonts?.faces || []);
  const direction = foundation.globalCssIntent?.direction === "rtl" ? "rtl" : "ltr";

  const astro = `---
import Layout from '../layouts/Layout.astro';
${registryImports.lines.join("\n")}
---
<Layout title=${JSON.stringify(title)} description=${JSON.stringify(description)}>
  <div data-rp-manifest=${JSON.stringify(plan.manifestHash)} data-rp-status=${JSON.stringify(plan.status)} dir=${JSON.stringify(direction)}>
    <header class="site-header" data-rp-unit="shared-chrome:home">
      <a href="/" aria-label=${JSON.stringify(title ? `${title} home` : "Home")}>${logoPath ? `<img src="${safe(logoPath)}" alt="${safe(logo?.accessibleName || title)}" />` : `<span>${safe(title)}</span>`}</a>
      ${navMarkup ? `<nav aria-label="Primary"><ul>${navMarkup}</ul></nav>` : ""}
    </header>
    <main id="content">${sectionMarkup}</main>
    ${chrome.footer ? `<footer data-rp-unit="shared-chrome:home">${footerContent(chrome.footer)}</footer>` : ""}
  </div>
</Layout>
<style>
  ${fontCss}
  :global(*){box-sizing:border-box}:global(body){margin:0;color:var(--rp-foreground,#1d1d1f);background:var(--rp-background,#fff);font-family:var(--rp-font-body,Arial,sans-serif)}
  .site-header{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:18px clamp(20px,6vw,96px);border-bottom:1px solid var(--rp-border,#ececec)}
  .site-header img{display:block;max-height:56px;max-width:220px}.site-header a{color:inherit;text-decoration:none}.site-header ul{display:flex;align-items:center;gap:20px;margin:0;padding:0;list-style:none}.site-header li{position:relative}.site-header li ul{display:none;position:absolute;z-index:10;min-width:14rem;padding:1rem;background:var(--rp-background,#fff)}.site-header li:focus-within>ul,.site-header li:hover>ul{display:grid}
  .rp-section{position:relative;padding:clamp(44px,8vw,112px) clamp(20px,7vw,120px);overflow:hidden}.rp-section h2{margin:0 0 16px;font-size:clamp(1.8rem,3.5vw,3.4rem);line-height:1.12}.rp-section p{max-width:900px;margin:0;line-height:1.7;white-space:pre-line}.rp-section-media{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:clamp(28px,7vw,120px)}.rp-section-media>img{width:100%;max-height:640px;object-fit:cover}.rp-items{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));gap:20px;margin-top:2rem}.rp-item{padding:1rem;border:1px solid var(--rp-border,#ddd)}footer{padding:34px clamp(20px,6vw,96px)}
  @media(max-width:760px){.site-header{align-items:flex-start}.site-header ul{flex-wrap:wrap}.rp-section-media{grid-template-columns:1fr}}
</style>
`;
  await writeText(path.join(outputDir, "src", "pages", "index.astro"), astro);
  const ledger = {
    schemaVersion: plan.schemaVersion,
    manifestHash: plan.manifestHash,
    pageKey: "home",
    units: plan.units.map((unit) => ({
      id: unit.id,
      specHash: unit.hash,
      status: unit.status === "provisional" ? "provisional" : "implemented",
      cloneRoot: ["foundation", "metadata"].includes(unit.kind) ? null : `[data-rp-unit="${unit.id}"]`,
      gapRefs: unit.gapRefs,
      verification: { desktop: "pending", tablet: "pending", mobile: "pending" },
    })),
  };
  await writeJson(path.join(docs, "build", "section-implementation.json"), ledger);
  return { outputDir, manifestHash: plan.manifestHash, status: plan.status, sections: sections.length, registryInstallations: registryInstallations.length, provisionalUnits: plan.units.filter((unit) => unit.status === "provisional").map((unit) => unit.id) };
}

export function renderSection(spec, specs = new Map(), selectionByUnit = new Map(), registrySymbols = new Map()) {
  const contentOptions = { allowVisibleCode: spec.extensions?.["wix.replatform.content-boundary"]?.visibleCode === true };
  const contamination = inspectContentObject(spec.content || {}, contentOptions);
  const content = removeContaminatedContent(spec.content || {}, contentOptions);
  const effectiveStatus = contamination.contaminated ? "provisional" : spec.status;
  const heading = safe(plain(content.heading || content.label));
  const text = safe(plain(content.text));
  const assets = Array.isArray(spec.assets) ? spec.assets : [];
  const image = assets.map(assetPath).find(Boolean);
  const items = Array.isArray(content.items) ? content.items : [];
  const itemMarkup = items.length ? `<div class="rp-items">${items.map((item) => `<article class="rp-item">${item.heading ? `<h3>${safe(plain(item.heading))}</h3>` : ""}${item.text || item.paragraphs ? `<p>${safe(plain(item.text || item.paragraphs?.join(" ")))}</p>` : ""}</article>`).join("")}</div>` : "";
  const children = (spec.children || []).map((id) => specs.get(id)).filter(Boolean).sort((a, b) => a.order - b.order);
  const childMarkup = children.length ? `<div class="rp-components">${children.map((child) => renderComponent(child, specs, selectionByUnit, registrySymbols)).join("")}</div>` : "";
  const body = `<div>${heading ? `<h2>${heading}</h2>` : ""}${text ? `<p>${text}</p>` : ""}${itemMarkup}${childMarkup}</div>`;
  const warning = contamination.contaminated ? ' data-rp-content-warning="source-code-contamination"' : "";
  return `<section id="${safe(spec.id)}" class="rp-section${image ? " rp-section-media" : ""}" data-rp-unit="${safe(spec.id)}" data-rp-classification="${safe(spec.classification?.kind)}" data-rp-status="${safe(effectiveStatus)}"${warning}>${image ? `<img src="${safe(image)}" alt="" loading="lazy" />` : ""}${body}</section>`;
}

function renderComponent(spec, specs, selectionByUnit, registrySymbols) {
  const selection = selectionByUnit.get(spec.id);
  const contentOptions = { allowVisibleCode: spec.extensions?.["wix.replatform.content-boundary"]?.visibleCode === true };
  const contamination = inspectContentObject(spec.content || {}, contentOptions);
  const content = removeContaminatedContent(spec.content || {}, contentOptions);
  const effectiveStatus = contamination.contaminated ? "provisional" : spec.status;
  const rawLabel = plain(content.label || content.heading || content.text || spec.classification?.kind);
  const label = safe(rawLabel);
  let ownMarkup;
  if (selection?.strategy === "curated-registry" && selection.selected?.name === "button") {
    const symbol = registrySymbols.get(`${selection.selected.name}@${selection.selected.revision}`);
    if (!symbol) throw new Error(`Installed registry button has no generated import for ${spec.id}`);
    ownMarkup = renderRegistryButton({ spec: { ...spec, content }, selection, symbol, label });
  } else {
    const tag = spec.classification?.kind === "button" ? "button" : "div";
    ownMarkup = `<${tag} data-rp-custom-component="${safe(spec.classification?.kind || "static-content")}">${label}</${tag}>`;
  }
  const children = (spec.children || []).map((id) => specs.get(id)).filter(Boolean).sort((a, b) => a.order - b.order);
  const warning = contamination.contaminated ? ' data-rp-content-warning="source-code-contamination"' : "";
  return `<div data-rp-unit="${safe(spec.id)}" data-rp-status="${safe(effectiveStatus)}"${warning}>${ownMarkup}${children.map((child) => renderComponent(child, specs, selectionByUnit, registrySymbols)).join("")}</div>`;
}

export function renderRegistryButton({ spec, selection, symbol, label }) {
  const binding = selection.selected.binding || { axes: {}, composition: "text" };
  const variant = binding.axes?.variant || "default";
  const size = binding.axes?.size || "default";
  const marker = `${safe(selection.selected.name)}@${safe(selection.selected.revision)}`;
  const props = `variant="${safe(variant)}" size="${safe(size)}" data-rp-registry-item="${marker}"`;
  const iconSource = assetPath(spec.content?.icon) || (spec.assets || []).map(assetPath).find(Boolean);
  const icon = iconSource ? `<img src="${safe(iconSource)}" alt="" aria-hidden="true" />` : "";
  const accessibleName = safe(plain(spec.content?.accessibleName || spec.content?.label || spec.content?.heading || spec.content?.text));
  if (binding.composition === "as-link") {
    const href = (spec.content?.links || []).find((link) => link?.href)?.href;
    if (!href) throw new Error(`Registry button binding for ${spec.id} requires href`);
    return `<${symbol} asChild ${props}><a href="${safe(href)}">${label}</a></${symbol}>`;
  }
  if (binding.composition === "icon-only") {
    if (!iconSource || !accessibleName) throw new Error(`Registry button binding for ${spec.id} requires icon and accessible name`);
    return `<${symbol} ${props} aria-label="${accessibleName}">${icon}</${symbol}>`;
  }
  if (binding.composition === "leading-icon") return `<${symbol} ${props}>${icon}${label}</${symbol}>`;
  if (binding.composition === "trailing-icon") return `<${symbol} ${props}>${label}${icon}</${symbol}>`;
  return `<${symbol} ${props}>${label}</${symbol}>`;
}

function registryComponentImports(selections) {
  const lines = [];
  const symbols = new Map();
  const seen = new Set();
  for (const selection of selections) {
    const selected = selection.selected;
    if (selection.strategy !== "curated-registry" || !selected || selected.name !== "button") continue;
    const key = `${selected.name}@${selected.revision}`;
    if (seen.has(key)) continue;
    const target = selected.files?.find((file) => file.type === "registry:ui")?.target;
    if (!target?.startsWith("src/")) throw new Error(`Registry component target must be under src/: ${target}`);
    const fromPages = `../${target.slice(4)}`.replace(/\.(?:tsx?|jsx?)$/, "");
    const symbol = `RpRegistry${selected.name.replace(/[^a-z0-9]+/gi, " ").split(/\s+/).filter(Boolean).map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join("")}`;
    lines.push(`import { Button as ${symbol} } from ${JSON.stringify(fromPages)};`);
    symbols.set(key, symbol);
    seen.add(key);
  }
  return { lines, symbols };
}

function renderNavItem(item) {
  const label = safe(plain(item.label || item.text));
  const href = safe(item.href || "#");
  const children = Array.isArray(item.children) ? item.children : [];
  return `<li><a href="${href}"${children.length ? ' aria-haspopup="true"' : ""}>${label}</a>${children.length ? `<ul>${children.map(renderNavItem).join("")}</ul>` : ""}</li>`;
}

function assetPath(value) {
  if (!value) return "";
  if (typeof value === "string") return normalizeAssetPath(value);
  return normalizeAssetPath(value.localPath || value.sourceUrl || value.url || value.src || "");
}

function normalizeAssetPath(value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("/")) return value;
  return `/${String(value).replace(/^public\//, "")}`;
}

function footerContent(footer) {
  const groups = footer?.groups || footer?.linkGroups || [];
  const links = groups.flatMap((group) => group.links || []).map((link) => `<a href="${safe(link.href || "#")}">${safe(plain(link.label || link.text))}</a>`).join(" ");
  const legal = safe(plain(footer?.legalText || footer?.text || ""));
  return `${links}${legal ? `<p>${legal}</p>` : ""}`;
}

function renderFontFaces(faces) {
  return faces.filter((face) => face.family && face.sources?.length).map((face) => {
    const sources = face.sources.filter((source) => source.localPath || source.url).map((source) => `url(${JSON.stringify(normalizeAssetPath(source.localPath || source.url))})${source.format ? ` format(${JSON.stringify(source.format)})` : ""}`).join(",");
    return sources ? `@font-face{font-family:${JSON.stringify(face.family)};src:${sources};font-style:${face.style || "normal"};font-weight:${face.weight || "normal"};${face.unicodeRange ? `unicode-range:${face.unicodeRange};` : ""}}` : "";
  }).join("\n");
}

async function main() {
  const args = parseArgs();
  if (!args.out) throw new Error("--out is required");
  console.log(JSON.stringify(await buildExtractedHomepage({ outputDir: path.resolve(String(args.out)) }), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
