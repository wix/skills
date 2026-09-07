#!/usr/bin/env node
import path from "node:path";
import { docsDir, parseArgs, readJson, resolveOutputDir, writeJson, writeText } from "./lib/common.mjs";

async function main() {
  const args = parseArgs();
  const outputDir = resolveOutputDir(args._[0] || args.url, args.out);
  const contract = await generateControlStateContract({ outputDir });
  if (args.json) process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
}

export async function generateControlStateContract({ outputDir, interactionMap: suppliedInteractionMap } = {}) {
  const docs = docsDir(outputDir);
  const interactionMap = suppliedInteractionMap || await readJson(path.join(docs, "interaction-map.json"));
  const controls = new Map();
  for (const interaction of interactionMap.interactions || []) {
    const trigger = typeof interaction.trigger === "string" ? interaction.trigger : interaction.trigger?.type;
    if (!interaction.controlRole && !["hover", "focus", "press", "click"].includes(trigger)) continue;
    const key = `${interaction.controlScope || "content"}\u0000${interaction.controlRole || "control"}\u0000${interaction.controlId || interaction.label || interaction.id}`;
    const control = controls.get(key) || {
      id: `control-${String(controls.size + 1).padStart(3, "0")}`,
      label: interaction.label || "Unlabelled control",
      role: interaction.controlRole || "control",
      scope: interaction.controlScope || "content",
      sourceInteractionIds: [],
      states: {},
      transition: null,
      ownerTransitions: [],
      iconMotion: [],
    };
    control.sourceInteractionIds.push(interaction.id);
    const states = interaction.states || [];
    if (!control.states.rest && states[0]) control.states.rest = { values: baseControlValues(states[0]), sourceObserved: true };
    const stateName = trigger === "focus" ? "focus-visible" : trigger === "press" ? "pressed" : trigger === "click" ? "activated" : trigger;
    if (stateName && states[1]) {
      control.states[stateName] = {
        values: compactChangedValues(states[1], interaction.changedProperties || []),
        changedProperties: interaction.changedProperties || [],
        sourceObserved: (interaction.changedProperties || []).length > 0 || interaction.textChanged,
      };
    }
    const rest = states[0] || {};
    if (!control.states.current && (rest.ariaCurrent || /(?:^|\s)(active|current|selected)(?:\s|$)/i.test(rest.className || ""))) {
      control.states.current = { values: baseControlValues(rest), sourceObserved: true };
    }
    if (!control.states.disabled && rest.disabled) control.states.disabled = { values: baseControlValues(rest), sourceObserved: true };
    if (!control.transition && states[0]?.styles) {
      control.transition = {
        property: states[0].styles.transitionProperty || "all",
        duration: states[0].styles.transitionDuration || "0s",
        easing: states[0].styles.transitionTimingFunction || "ease",
      };
    }
    for (const child of states[0]?.visualChildren || []) {
      const duration = child.styles?.transitionDuration || "0s";
      if (duration === "0s" || control.ownerTransitions.some((item) => item.owner === `child:${child.key}`)) continue;
      control.ownerTransitions.push({ owner: `child:${child.key}`, property: child.styles?.transitionProperty || "all", duration, easing: child.styles?.transitionTimingFunction || "ease" });
    }
    for (const pseudo of ["before", "after"]) {
      const duration = states[0]?.pseudo?.[pseudo]?.transitionDuration || "0s";
      if (duration !== "0s" && !control.ownerTransitions.some((item) => item.owner === `::${pseudo}`)) {
        control.ownerTransitions.push({ owner: `::${pseudo}`, property: states[0].pseudo[pseudo].transitionProperty || "all", duration, easing: states[0].pseudo[pseudo].transitionTimingFunction || "ease" });
      }
    }
    for (const property of interaction.changedProperties || []) {
      if (/^child:|^::/.test(property) && /transform|translate|scale|rotate|top|left|right|bottom/.test(property)) {
        if (!control.iconMotion.includes(property)) control.iconMotion.push(property);
      }
    }
    controls.set(key, control);
  }
  const compiledControls = mergeEquivalentControls(Array.from(controls.values()));
  const contract = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceUrl: interactionMap.sourceUrl || "",
    terminology: {
      rest: "Pointer absent and control not focused or pressed.",
      hover: "Pointer is over the control.",
      "focus-visible": "Keyboard-visible focus state; must remain perceivable even when absent from the source.",
      pressed: "Pointer or key is held down; CSS :active equivalent.",
      activated: "State immediately after activation/click.",
      current: "Current route, tab, or selected control.",
      disabled: "Unavailable control.",
    },
    precedence: ["source-observed-state", "accessible-focus-fallback", "identity-preserving-normalization"],
    controls: compiledControls,
    requirements: [
      "Implement every sourceObserved state delta on the target, pseudo-element, or child that owns it.",
      "Do not apply an icon transform to the whole button when only the nested icon moved in source evidence.",
      "Preserve source transition duration and easing; otherwise use a subtle eased transition and respect prefers-reduced-motion.",
      "Add a perceivable focus-visible state when the source exposes none, without replacing captured hover/current styling.",
    ],
  };
  await writeJson(path.join(docs, "control-state-contract.json"), contract);
  await writeText(path.join(docs, "control-state-contract.md"), renderMarkdown(contract));
  return contract;
}

function mergeEquivalentControls(controls) {
  const groups = new Map();
  for (const control of controls) {
    const signature = JSON.stringify({ role: control.role, scope: control.scope, states: control.states, transition: control.transition, ownerTransitions: control.ownerTransitions, iconMotion: control.iconMotion });
    const existing = groups.get(signature);
    if (!existing) {
      groups.set(signature, { ...control, members: [control.label] });
      continue;
    }
    if (!existing.members.includes(control.label)) existing.members.push(control.label);
    existing.sourceInteractionIds.push(...control.sourceInteractionIds);
  }
  return Array.from(groups.values()).map((control, index) => ({
    ...control,
    id: `control-${String(index + 1).padStart(3, "0")}`,
    sourceInteractionIds: Array.from(new Set(control.sourceInteractionIds)),
  }));
}

function baseControlValues(snapshot = {}) {
  const style = snapshot.styles || {};
  return {
    color: style.color,
    backgroundColor: style.backgroundColor,
    borderColor: style.borderColor,
    borderWidth: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
    textDecoration: {
      line: style.textDecorationLine,
      color: style.textDecorationColor,
      thickness: style.textDecorationThickness,
      offset: style.textUnderlineOffset,
    },
    outline: {
      color: style.outlineColor,
      style: style.outlineStyle,
      width: style.outlineWidth,
      offset: style.outlineOffset,
    },
    cursor: style.cursor,
    ariaCurrent: snapshot.ariaCurrent || "",
    ariaSelected: snapshot.ariaSelected || "",
    ariaExpanded: snapshot.ariaExpanded || "",
    disabled: Boolean(snapshot.disabled),
  };
}

function compactChangedValues(snapshot, properties) {
  return Object.fromEntries((properties || []).map((property) => [property, snapshotValue(snapshot, property)]));
}

function snapshotValue(snapshot = {}, property) {
  const child = String(property).match(/^child:(.+?)(?:::(before|after))?\.([^.]+)$/);
  if (child) {
    const record = (snapshot.visualChildren || []).find((item) => item.key === child[1]);
    return child[2] ? record?.pseudo?.[child[2]]?.[child[3]] : record?.styles?.[child[3]];
  }
  const pseudo = String(property).match(/^::(before|after)\.([^.]+)$/);
  if (pseudo) return snapshot.pseudo?.[pseudo[1]]?.[pseudo[2]];
  if (snapshot.styles && property in snapshot.styles) return snapshot.styles[property];
  return snapshot[property];
}

function renderMarkdown(contract) {
  return `# Control State Contract\n\nSource: ${contract.sourceUrl}\n\nState precedence: ${contract.precedence.map((item) => `\`${item}\``).join(" → ")}\n\n${contract.requirements.map((item) => `- ${item}`).join("\n")}\n\n## Representative controls\n\n${contract.controls.map((control) => `### ${control.label}\n\n- role/scope: \`${control.role}\` / \`${control.scope}\`\n- members: ${control.members.join(", ")}\n- states: ${Object.keys(control.states).map((state) => `\`${state}\``).join(", ") || "none observed"}\n- icon-owned motion: ${control.iconMotion.map((item) => `\`${item}\``).join(", ") || "none"}\n- owner transitions: ${control.ownerTransitions.map((item) => `\`${item.owner} ${item.duration} ${item.easing}\``).join(", ") || "none"}\n- evidence: ${control.sourceInteractionIds.map((id) => `\`interaction-map.json#${id}\``).join(", ")}`).join("\n\n") || "_No representative controls captured._"}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
