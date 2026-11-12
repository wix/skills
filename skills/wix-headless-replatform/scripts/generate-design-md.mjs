#!/usr/bin/env node
import path from "node:path";
import { docsDir, normalizeUrl, parseArgs, readJson, resolveOutputDir, writeText } from "./lib/common.mjs";

async function main() {
  const args = parseArgs();
  const url = normalizeUrl(args._[0] || args.url).toString();
  const outputDir = resolveOutputDir(url, args.out);
  const markdown = await generateDesignMd({ outputDir, sourceUrl: url });
  await writeText(path.join(docsDir(outputDir), "design.md"), markdown);
  if (args.stdout) process.stdout.write(markdown);
}

export async function generateDesignMd({ outputDir, sourceUrl }) {
  const dir = docsDir(outputDir);
  const sourceMap = await safeRead(path.join(dir, "source-map.json"), { pages: [], project: {} });
  const tokens = await safeRead(path.join(dir, "tokens.json"), sourceMap.tokens || {});
  const assets = await safeRead(path.join(dir, "assets.json"), { assets: [] });
  const fonts = await safeRead(path.join(dir, "fonts.json"), sourceMap.fonts || { faces: [] });
  const seo = await safeRead(path.join(dir, "seo.json"), sourceMap.seo || {});
  const title = seo.title || sourceMap.pages?.[0]?.title || new URL(sourceUrl).hostname;
  const sections = sourceMap.pages?.flatMap((page) => page.sections || []).slice(0, 18) || [];
  const chrome = sourceMap.pages?.find((page) => page.chrome)?.chrome || null;
  const extraction = tokens.extraction || sourceMap.designExtraction || { source: "local" };
  return `# Design System

Source: ${sourceUrl}

## Extraction

- Source: ${extraction.source || "local"}
- Selected extractor: ${extraction.selectedExtractor || sourceMap.designExtraction?.selectedExtractor || extraction.source || "local"}
${extraction.fallbackReason ? `- Fallback reason: ${extraction.fallbackReason}` : "- Fallback reason: none"}
${formatExtractionAttempts(extraction.attempts || sourceMap.designExtraction?.attempts || [])}
${tokens.designMdGenerator ? "- design-md-generator artifacts: `docs/site-clone/design-md-generator/`" : "- design-md-generator artifacts: not available"}

## Brand Summary

- Site title: ${title}
- Visual position: infer from source screenshots, brand assets, extracted design tokens, typography, and section rhythm.
- Primary goal: preserve recognizable source brand while rebuilding as a Wix Headless Astro/Tailwind frontend.

## Assets

${(assets.assets || []).slice(0, 20).map((asset) => `- ${asset.type}: \`${asset.localPath}\` from ${asset.sourceUrl}`).join("\n") || "- No downloaded assets recorded yet."}

## Color Tokens

${list(tokens.colors, "No colors extracted. Inspect screenshots and CSS manually.")}

Recommended Tailwind variables:

${tailwindRecommendations(tokens)}

## Typography

Font families:

${list(tokens.fontFamilies, "No font families extracted. Inspect computed styles and downloaded font files.")}

Font sizes:

${list(tokens.fontSizes, "No font sizes extracted. Use source screenshots and computed styles.")}

- Copy the exact source \`@font-face\` blocks with local URLs substituted; do not pick a downloaded font file by family name alone.
- Use \`docs/site-clone/fonts.json\` as the source of truth for \`font-family\`, \`font-style\`, \`font-weight\`, and \`unicode-range\`.
- Map body and display roles from the extracted font families before building page sections.
- Set body, headings, links, buttons, and small text explicitly.
- Preserve source line-height and letter-spacing where the extracted tokens report them; otherwise derive them from screenshots and computed styles.

### Extracted Font Faces

${formatFontFaces(fonts)}

## Layout And Spacing

- Use source section order and rhythm as the baseline.
- Define shared containers for narrow, default, and wide content.
- Keep mobile and desktop layouts close enough rather than pixel-identical.
- Avoid placeholder sections; every visible block should map back to source evidence.
${tokens.spacing?.length ? `- Spacing scale: ${inlineList(tokens.spacing)}.` : "- Spacing scale: infer from section rhythm and component specs."}
${tokens.breakpoints?.length ? `- Breakpoints: ${inlineList(tokens.breakpoints)}.` : "- Breakpoints: use desktop, tablet, and mobile screenshots as responsive checkpoints."}

## Header And Navigation

${chromeSummary(chrome)}

## First Viewport Evidence

${firstViewportSummary(chrome)}

## Radii, Borders, Shadows

Radii:

${list(tokens.radii, "No radii extracted. Infer from cards, buttons, forms, and media corners.")}

Shadows:

${list(tokens.shadows, "No shadows extracted. Infer elevation from source UI.")}

## Global CSS Recommendations

- Define theme variables in one global stylesheet before writing sections.
- Load local fonts from downloaded assets when available; otherwise use the closest source fallback stack.
- Run \`node skills/wix-headless-replatform/scripts/validate-font-contract.mjs ${sourceUrl} --out ${outputDir}\` after implementing local \`@font-face\` declarations.
- Set \`html\`, \`body\`, base text color, background color, link color, and focus styles globally.
- Verify the implemented global font family and primary text color against extracted tokens before styling sections.
- Add reusable utilities for source-aligned containers, section padding, product grids, and CTA groups.

## Component Patterns

- Header/nav: preserve menu labels, order, dropdown intent, and CTA priority.
- Header behavior: if the source has a large static header and a smaller scrolled sticky/fixed header, approximate that pattern with a compact sticky state rather than pinning the large header.
- Footer: preserve link groups, legal links, contact/social signals, and brand treatment.
- Buttons/links: derive size, radius, colors, hover states, and typography from source CTAs.
- Inputs: preserve source border, radius, focus, disabled, placeholder, and validation treatment.
- Cards/forms/badges: use source spacing, border, radius, and shadow rules.
- Menus: preserve dropdown hierarchy, mobile drawer behavior, spacing, and active states.
- Hero content: render only text and CTAs visible in first-viewport source evidence; do not turn SEO titles or metadata into hero copy.
- Dynamic data templates: build reusable Wix SDK-backed components for products, posts, categories, CMS items, bookings, and events.
- Not-migrated fallback: use the same brand/layout system.

## Source Section Inventory

${sections.map((section, index) => `### ${index + 1}. ${section.heading || section.tag || "Section"}\n\n${section.text || "_No text captured._"}`).join("\n\n") || "_No sections captured._"}

## Implementation Checklist

- Set Tailwind/theme variables before building pages.
- Add global CSS and local font loading.
- Build shared header, footer, layout, and CTA components first.
- Build static pages from component specs.
- Build dynamic Wix SDK-backed routes for repeated data-driven templates.
- Add branded not-migrated fallback.
- Run build, link, SEO, and visual QA.
`;
}

function list(values, empty) {
  if (!values?.length) return `- ${empty}`;
  return values.map((value) => `- \`${value}\``).join("\n");
}

function inlineList(values) {
  return values.map((value) => `\`${value}\``).join(", ");
}

function chromeSummary(chrome) {
  if (!chrome) {
    return [
      "- No browser chrome evidence was captured.",
      "- Manually inspect source screenshots for header height, sticky behavior, logo scale, dropdown hierarchy, and mobile menu behavior before implementing shared chrome.",
    ].join("\n");
  }
  const lines = [];
  lines.push(`- Source direction: \`${chrome.direction || "unknown"}\`.`);
  for (const variant of chrome.header?.variants || []) {
    const logo = variant.logo
      ? ` Logo rendered about ${variant.logo.renderedWidth}x${variant.logo.renderedHeight}px.`
      : "";
    lines.push(`- Header ${variant.name}: ${variant.visible === false ? "not visible" : `${variant.height || 0}px high, ${variant.position || "unknown"} positioning at scrollY ${variant.visibleAtScrollY || 0}`}.${logo}`);
  }
  const stickyLimit = chrome.header?.maxStickyViewportRatio || 0.16;
  lines.push(`- Do not keep a sticky/fixed header taller than about ${Math.round(stickyLimit * 100)}% of desktop viewport height unless source evidence shows that exact behavior.`);
  const nav = chrome.navigation || [];
  if (nav.length) {
    const dropdowns = nav.filter((item) => item.children?.length);
    lines.push(`- Top-level navigation items detected: ${nav.length}.`);
    if (dropdowns.length) {
      lines.push(`- Dropdown menus detected: ${dropdowns.map((item) => `${item.label || item.href} (${item.children.length} children)`).join(", ")}.`);
      lines.push("- Preserve dropdown children as submenu items; do not promote them to top-level links at the same viewport.");
    } else {
      lines.push("- No dropdown hierarchy was detected in browser evidence; verify manually if source screenshots show menus.");
    }
  } else {
    lines.push("- No structured navigation hierarchy was captured; use screenshots and DOM review before flattening links.");
  }
  for (const warning of chrome.warnings || []) lines.push(`- Warning: ${warning}.`);
  return lines.join("\n");
}

function firstViewportSummary(chrome) {
  const evidence = chrome?.heroEvidence;
  if (!evidence) {
    return "- No first-viewport text evidence was captured. Do not infer hero copy from SEO metadata without source visual evidence.";
  }
  const lines = [];
  if (evidence.visibleText?.length) {
    lines.push("- Visible first-viewport text samples:");
    for (const text of evidence.visibleText.slice(0, 12)) lines.push(`  - ${text}`);
  } else {
    lines.push("- No non-header first-viewport text was captured; keep hero media clean unless screenshots show visible copy or CTAs.");
  }
  if (evidence.forbiddenSeoOnlyText?.length) {
    lines.push("- SEO-only text not confirmed as visible hero content:");
    for (const text of evidence.forbiddenSeoOnlyText.slice(0, 8)) lines.push(`  - ${text}`);
    lines.push("- Do not render the SEO-only text above as hero copy unless visual evidence confirms it.");
  }
  return lines.join("\n");
}

function tailwindRecommendations(tokens) {
  if (typeof tokens.recommendedTailwindTokens?.colors === "string") {
    const recommendations = [
      tokens.recommendedTailwindTokens.colors,
      tokens.recommendedTailwindTokens.fonts,
      tokens.recommendedTailwindTokens.spacing,
      tokens.recommendedTailwindTokens.radii,
      tokens.recommendedTailwindTokens.shadows,
    ].filter(Boolean);
    return recommendations.map((item) => `- ${item}`).join("\n");
  }
  return [
    "`--background`",
    "`--foreground`",
    "`--primary`",
    "`--primary-foreground`",
    "`--secondary`",
    "`--muted`",
    "`--accent`",
    "`--border`",
  ].map((item) => `- ${item}`).join("\n");
}

function formatExtractionAttempts(attempts) {
  if (!attempts?.length) return "- Fallback attempts: none recorded";
  return `- Fallback attempts:\n${attempts.map((attempt) => `  - ${attempt.extractor}${attempt.mode ? `/${attempt.mode}` : ""}: ${attempt.status}${attempt.reason ? ` (${attempt.reason})` : ""}`).join("\n")}`;
}

function formatFontFaces(fonts) {
  if (!fonts?.faces?.length) return "- No font-face declarations extracted.";
  return fonts.faces
    .slice(0, 18)
    .map((face) => {
      const sources = (face.sources || [])
        .map((source) =>
          source.kind === "url"
            ? `\`${source.localPath || source.url}\`${source.localPath ? ` from ${source.url}` : ""}`
            : `local(${source.value})`,
        )
        .join(", ");
      return `- \`${face.family}\` / ${face.style} / ${face.weight}${face.unicodeRange ? ` / ${face.unicodeRange}` : ""} -> ${sources || "no URL sources"}`;
    })
    .join("\n");
}

async function safeRead(filePath, fallback) {
  try {
    return await readJson(filePath);
  } catch {
    return fallback;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
