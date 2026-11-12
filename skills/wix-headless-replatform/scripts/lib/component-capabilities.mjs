export const COMPONENT_CAPABILITIES_SCHEMA_VERSION = "component-capabilities/1";

const TOP_LEVEL_FIELDS = new Set([
  "$schema", "schemaVersion", "component", "contract", "axes", "slots", "states",
  "defaultComposition", "compositions", "unsupportedCompositions", "constraints", "evidenceRefs",
]);
const SLOT_KINDS = new Set(["text", "icon", "url", "action", "media", "content", "boolean", "number"]);

export function validateComponentCapabilities(manifest, expected = {}) {
  const errors = [];
  if (!isObject(manifest)) return { ok: false, errors: ["capability manifest must be an object"] };
  for (const field of Object.keys(manifest)) if (!TOP_LEVEL_FIELDS.has(field)) errors.push(`unknown top-level field: ${field}`);
  if (manifest.schemaVersion !== COMPONENT_CAPABILITIES_SCHEMA_VERSION) errors.push(`schemaVersion must be ${COMPONENT_CAPABILITIES_SCHEMA_VERSION}`);
  if (!isObject(manifest.component) || !manifest.component.name || !manifest.component.revision) errors.push("component name and revision are required");
  if (!isObject(manifest.contract) || !manifest.contract.name || !manifest.contract.version) errors.push("contract name and version are required");
  rejectUnknown(manifest.component, new Set(["name", "revision"]), "component", errors);
  rejectUnknown(manifest.contract, new Set(["name", "version"]), "contract", errors);
  if (expected.name && manifest.component?.name !== expected.name) errors.push(`component name must be ${expected.name}`);
  if (expected.revision && manifest.component?.revision !== expected.revision) errors.push(`component revision must be ${expected.revision}`);
  if (expected.contract && manifest.contract?.name !== expected.contract) errors.push(`contract name must be ${expected.contract}`);

  const axes = uniqueNamed(manifest.axes, "axis", errors);
  for (const axis of axes) {
    if (!Array.isArray(axis.values) || !axis.values.length || axis.values.some((value) => typeof value !== "string")) errors.push(`axis ${axis.name} requires string values`);
    if (new Set(axis.values || []).size !== (axis.values || []).length) errors.push(`axis ${axis.name} values must be unique`);
    if (!axis.values?.includes(axis.default)) errors.push(`axis ${axis.name} default must be one of its values`);
    rejectUnknown(axis, new Set(["name", "values", "default", "description"]), `axis ${axis.name}`, errors);
  }
  const slots = uniqueNamed(manifest.slots, "slot", errors);
  for (const slot of slots) {
    if (!SLOT_KINDS.has(slot.kind)) errors.push(`slot ${slot.name} has unsupported kind ${slot.kind}`);
    rejectUnknown(slot, new Set(["name", "kind", "description"]), `slot ${slot.name}`, errors);
  }
  uniqueStrings(manifest.states, "states", errors);
  const compositions = uniqueNamed(manifest.compositions, "composition", errors);
  const compositionNames = new Set(compositions.map((entry) => entry.name));
  const slotNames = new Set(slots.map((entry) => entry.name));
  if (!compositionNames.has(manifest.defaultComposition)) errors.push("defaultComposition must name a supported composition");
  for (const composition of compositions) {
    uniqueStrings(composition.requiredSlots, `composition ${composition.name} requiredSlots`, errors);
    for (const slot of composition.requiredSlots || []) if (!slotNames.has(slot)) errors.push(`composition ${composition.name} references unknown slot ${slot}`);
    rejectUnknown(composition, new Set(["name", "requiredSlots", "description"]), `composition ${composition.name}`, errors);
  }
  const unsupported = uniqueNamed(manifest.unsupportedCompositions, "unsupported composition", errors);
  for (const entry of unsupported) {
    if (!entry.reason) errors.push(`unsupported composition ${entry.name} requires a reason`);
    if (compositionNames.has(entry.name)) errors.push(`composition ${entry.name} cannot be both supported and unsupported`);
    rejectUnknown(entry, new Set(["name", "reason"]), `unsupported composition ${entry.name}`, errors);
  }
  const constraints = uniqueNamed(manifest.constraints, "constraint", errors, "id");
  for (const constraint of constraints) {
    if (!constraint.description) errors.push(`constraint ${constraint.id} requires a description`);
    uniqueStrings(constraint.appliesTo, `constraint ${constraint.id} appliesTo`, errors);
    uniqueStrings(constraint.requires, `constraint ${constraint.id} requires`, errors);
    rejectUnknown(constraint, new Set(["id", "description", "appliesTo", "requires"]), `constraint ${constraint.id}`, errors);
  }
  uniqueStrings(manifest.evidenceRefs, "evidenceRefs", errors, { minimum: 1 });
  return { ok: errors.length === 0, errors };
}

export function resolveCapabilityBinding(manifest, requirements = {}) {
  const validation = validateComponentCapabilities(manifest);
  if (!validation.ok) return { ok: false, reasons: validation.errors };
  const reasons = [];
  const axes = Object.fromEntries(manifest.axes.map((axis) => [axis.name, requirements.axes?.[axis.name] ?? axis.default]));
  for (const [name, value] of Object.entries(requirements.axes || {})) {
    const axis = manifest.axes.find((entry) => entry.name === name);
    if (!axis) reasons.push(`unsupported-axis:${name}`);
    else if (!axis.values.includes(value)) reasons.push(`unsupported-axis-value:${name}=${value}`);
  }
  const compositionName = requirements.composition || manifest.defaultComposition;
  const composition = manifest.compositions.find((entry) => entry.name === compositionName);
  if (!composition) reasons.push(`unsupported-composition:${compositionName}`);
  const availableSlots = new Set(requirements.availableSlots || []);
  for (const slot of requirements.requiredSlots || []) {
    if (!manifest.slots.some((entry) => entry.name === slot)) reasons.push(`unsupported-slot:${slot}`);
  }
  for (const slot of composition?.requiredSlots || []) if (!availableSlots.has(slot)) reasons.push(`missing-slot:${slot}`);
  for (const state of requirements.requiredStates || []) if (!manifest.states.includes(state)) reasons.push(`unsupported-state:${state}`);

  const selectedTokens = new Set([
    `composition:${compositionName}`,
    ...Object.entries(axes).map(([name, value]) => `axis:${name}=${value}`),
    ...[...availableSlots].map((slot) => String(slot).startsWith("slot:") ? slot : `slot:${slot}`),
  ]);
  for (const constraint of manifest.constraints) {
    if ((constraint.appliesTo || []).every((token) => selectedTokens.has(token))) {
      for (const token of constraint.requires || []) if (!selectedTokens.has(token)) reasons.push(`constraint:${constraint.id}:${token}`);
    }
  }
  return {
    ok: reasons.length === 0,
    reasons: [...new Set(reasons)],
    binding: { axes, composition: compositionName, availableSlots: [...availableSlots].sort() },
  };
}

function uniqueNamed(value, label, errors, key = "name") {
  if (!Array.isArray(value)) {
    errors.push(`${label}s must be an array`);
    return [];
  }
  const entries = value.filter((entry) => isObject(entry));
  if (entries.length !== value.length) errors.push(`${label}s must contain objects`);
  const names = entries.map((entry) => entry[key]);
  if (names.some((name) => typeof name !== "string" || !name)) errors.push(`${label}s require ${key}`);
  if (new Set(names).size !== names.length) errors.push(`${label} ${key}s must be unique`);
  return entries;
}

function uniqueStrings(value, label, errors, { minimum = 0 } = {}) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry)) errors.push(`${label} must contain strings`);
  else if (new Set(value).size !== value.length) errors.push(`${label} must be unique`);
  if ((value?.length || 0) < minimum) errors.push(`${label} must contain at least ${minimum} item(s)`);
}

function rejectUnknown(value, allowed, label, errors) {
  for (const field of Object.keys(value || {})) if (!allowed.has(field)) errors.push(`${label} has unknown field ${field}`);
}

function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
