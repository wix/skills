// Forms seed — a BUILD-TIME script, never shipped in the app. Run from the project root
// (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/templates/forms/seed/seed-forms.mjs plan.json
//
// It mints its own site token via the Wix CLI, installs the Wix Forms app if needed, expands
// each plan field into the nested Form Schemas v4 shape, creates the forms, and READS EACH ONE
// BACK to prove the fields survived (a create returns 200 even when a choice field silently
// degraded to a plain text box). Prints a JSON result to stdout.
//
// Plan shape (see SEED.md):
//   { "forms": [{ "name", "submitText"?, "nextText"?, "previousText"?, "steps"?, "rules"?,
//                 "thankYou"?, "thankYouSeconds"?, "redirect"?, "deadline"?, "maxSubmissions"?,
//                 "perVisitor"?, "requiredIndicator"?,
//                 "fields": [{ "label", "kind", "required"?, "placeholder"?, "description"?, "default"?,
//                              "choices"?, "other"?, "min"?, "max"?, "step"?, "minLength"?, "maxLength"?,
//                              "pattern"?, "patternMessage"?, "fileLimit"?, "formats"?, "countries"?,
//                              "country"?, "buttonText"?, "hidden"? }] }] }
//
// The plan is PLAIN DATA — labels and kinds. Everything the API demands and the docs bury is
// derived here: per-field UUIDs, the two-level options nesting, the validation block that must
// exist even when empty, the choice enum that must agree with the component's options, the
// per-component prefill key, the snake_case+suffix target, a `steps` layout referencing every
// field including the submit button (a field missing from `steps` never appears in the owner's
// dashboard), and rules keyed by field id.
//
// Seeding is ADDITIVE — never deletes or overwrites existing forms.
import { seedSiteId } from "../../shared/seed/site-context.mjs";
import { wixToken } from "../../shared/seed/wix-cli.mjs";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const API = "https://www.wixapis.com";
const FORMS_APP_ID = "225dd912-7dea-4738-8688-4b8c6955ffc2";
const NAMESPACE = "wix.form_app.form";

export function makeCtx({ cwd = process.cwd() } = {}) {
  // The content site: the config's site, or the parent on a migration preview (site-context.mjs stops
  // a seed there unless --allow-parent is passed after the user confirmed).
  const siteId = seedSiteId({ cwd, argv: process.argv });
  const token = wixToken(siteId, cwd);
  return { token, siteId };
}

async function req(ctx, path, { method = "POST", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      "wix-site-id": ctx.siteId,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

/** Idempotent. Nothing here works until the app is installed. */
export async function installFormsApp(ctx) {
  try {
    await req(ctx, "/apps-installer-service/v1/app-instance/install", {
      body: {
        tenant: { tenantType: "SITE", id: ctx.siteId },
        appInstance: { appDefId: FORMS_APP_ID, enabled: true },
      },
    });
  } catch {
    /* already installed is fine */
  }
}

// ---- field expansion -------------------------------------------------------------------------

// kind → { inputType, componentType, identifier, format?, contact? }
// The two block names are what the API nests settings under, and they are named after the
// field's own enums — which is why they are looked up here rather than spelled at each call.
// `contact` is the per-field contactMapping: it is what makes a submission create or update the
// site's CRM contact (the older postSubmissionTriggers.upsertContact is ignored by v4).
const KINDS = {
  text:      { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "TEXT_INPUT" },
  textarea:  { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "TEXT_AREA" },
  email:     { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "CONTACTS_EMAIL", format: "EMAIL", contact: { contactField: "EMAIL", emailInfo: { tag: "UNTAGGED" } } },
  phone:     { inputType: "STRING", componentType: "PHONE_INPUT",    identifier: "CONTACTS_PHONE", format: "PHONE", contact: { contactField: "PHONE", phoneInfo: { tag: "UNTAGGED" } } },
  url:       { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "URL_INPUT", format: "URL" },
  firstName: { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "CONTACTS_FIRST_NAME", contact: { contactField: "FIRST_NAME" } },
  lastName:  { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "CONTACTS_LAST_NAME", contact: { contactField: "LAST_NAME" } },
  company:   { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "CONTACTS_COMPANY", contact: { contactField: "COMPANY" } },
  date:      { inputType: "STRING", componentType: "DATE_PICKER",    identifier: "DATE_PICKER", format: "DATE", dateBlock: "dateOptions" },
  time:      { inputType: "STRING", componentType: "TIME_INPUT",     identifier: "TIME_INPUT", format: "TIME", dateBlock: "timeOptions" },
  datetime:  { inputType: "STRING", componentType: "DATE_TIME",      identifier: "DATE_TIME_INPUT", format: "DATE_TIME", dateBlock: "dateTimeOptions" },
  number:    { inputType: "NUMBER", componentType: "NUMBER_INPUT",   identifier: "NUMBER_INPUT" },
  rating:    { inputType: "NUMBER", componentType: "RATING_INPUT",   identifier: "RATING_INPUT" },
  select:    { inputType: "STRING", componentType: "DROPDOWN",       identifier: "DROPDOWN" },
  radio:     { inputType: "STRING", componentType: "RADIO_GROUP",    identifier: "RADIO_GROUP" },
  multi:     { inputType: "ARRAY",  componentType: "CHECKBOX_GROUP", identifier: "CHECKBOX_GROUP" },
  tags:      { inputType: "ARRAY",  componentType: "TAGS",           identifier: "TAGS" },
  checkbox:  { inputType: "BOOLEAN", componentType: "CHECKBOX",      identifier: "CHECKBOX" },
  file:      { inputType: "WIX_FILE", componentType: "FILE_UPLOAD",  identifier: "FILE_UPLOAD" },
  address:   { inputType: "ADDRESS", componentType: "MULTILINE_ADDRESS", identifier: "MULTILINE_ADDRESS" },
};

const INPUT_BLOCK = {
  STRING: "stringOptions", NUMBER: "numberOptions", BOOLEAN: "booleanOptions",
  ARRAY: "arrayOptions", ADDRESS: "addressOptions", WIX_FILE: "wixFileOptions",
};
const COMPONENT_BLOCK = {
  TEXT_INPUT: "textInputOptions", PHONE_INPUT: "phoneInputOptions", NUMBER_INPUT: "numberInputOptions",
  RATING_INPUT: "ratingInputOptions", DATE_PICKER: "datePickerOptions", TIME_INPUT: "timeInputOptions",
  DATE_TIME: "dateTimeOptions", CHECKBOX: "checkboxOptions", CHECKBOX_GROUP: "checkboxGroupOptions",
  TAGS: "tagsOptions", RADIO_GROUP: "radioGroupOptions", DROPDOWN: "dropdownOptions",
  MULTILINE_ADDRESS: "multilineAddressOptions", FILE_UPLOAD: "fileUploadOptions",
};

// The address subfields the owner can require. `country` is always shown by the runtime; the
// others follow the country template. `validation.fields` only carries required-ness.
const ADDRESS_PARTS = ["country", "addressLine", "addressLine2", "city", "subdivision", "postalCode"];
const ADDRESS_REQUIRED_WHEN_REQUIRED = ["country", "addressLine", "city", "postalCode"];

/** One paragraph of Ricos rich content — the shape of a checkbox label, a thank-you message. */
function richText(text) {
  return {
    nodes: [
      {
        type: "PARAGRAPH",
        id: randomUUID().slice(0, 8),
        nodes: [{ type: "TEXT", id: "", nodes: [], textData: { text: String(text), decorations: [] } }],
        paragraphData: {},
      },
    ],
    metadata: { version: 1 },
  };
}

/**
 * `target` is the IMMUTABLE submission key: starts with a letter, letters/digits/underscore
 * only, no doubled underscore, unique within the form. The random suffix is what keeps two
 * fields with the same label apart.
 */
function targetFor(label, taken) {
  const base =
    String(label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .replace(/^(?=\d)/, "f_")
      .slice(0, 40) || "field";
  let target;
  do {
    target = `${base}_${Math.random().toString(36).slice(2, 8)}`;
  } while (taken.has(target));
  taken.add(target);
  return target;
}

function buildField(spec, taken) {
  const kind = KINDS[spec.kind];
  if (!kind) {
    throw new Error(
      `field "${spec.label}": unknown kind "${spec.kind}" — one of ${Object.keys(KINDS).join(", ")}`,
    );
  }
  const isChoice = ["select", "radio", "multi", "tags"].includes(spec.kind);
  const choices = spec.choices ?? [];
  if (isChoice && !choices.length) {
    throw new Error(`field "${spec.label}": kind "${spec.kind}" needs a non-empty choices array`);
  }

  const target = targetFor(spec.label, taken);
  const defaults = [].concat(spec.default ?? []).map(String);
  const options = choices.map((c) => {
    const value = typeof c === "string" ? c : c.value;
    return {
      id: randomUUID(),
      label: typeof c === "string" ? c : (c.label ?? c.value),
      value,
      // A preselected choice is marked on the OPTION (`options[].default`), not on the component.
      ...(defaults.includes(String(value)) ? { default: true } : {}),
    };
  });
  const values = options.map((o) => o.value);
  const other = spec.other
    ? { label: typeof spec.other === "string" ? spec.other : "Other", ...(spec.otherPlaceholder ? { placeholder: spec.otherPlaceholder } : {}) }
    : null;

  // A choice field declares its options TWICE — here and in the validation enum — and the two
  // must agree. Disagree and the create still returns 200: the field is created as a plain
  // text box, losing its choices. Both are derived from the same list, so they cannot drift.
  // A free-text "Other" entry is anything outside the list, so no enum is written with it (the
  // validator ignores the enum when a customOption is defined).
  const validation = {};
  if (kind.format) validation.format = kind.format;
  if (kind.dateBlock) {
    // Date bounds live under the format's options block; `$now`, `$now+2d`, `$now-1M` are accepted.
    const bounds = { ...(spec.min != null ? { minimum: String(spec.min) } : {}), ...(spec.max != null ? { maximum: String(spec.max) } : {}) };
    if (Object.keys(bounds).length) validation[kind.dateBlock] = bounds;
  } else {
    if (spec.min != null) validation.minimum = spec.min;
    if (spec.max != null) validation.maximum = spec.max;
  }
  if (spec.step != null) validation.multipleOf = spec.step;
  if (spec.minLength != null) validation.minLength = spec.minLength;
  if (spec.maxLength != null) validation.maxLength = spec.maxLength;
  if (spec.pattern) validation.pattern = spec.pattern;
  if (spec.patternMessage) validation.validationMessages = { pattern: spec.patternMessage };
  if (spec.minItems != null) validation.minItems = spec.minItems;
  if (spec.maxItems != null) validation.maxItems = spec.maxItems;
  if (values.length) {
    if (kind.inputType === "ARRAY") {
      // `itemType` sits INSIDE `items`, beside the options block; one level up the create is a 400
      // whose message blames the options block ("itemType cannot be provided with ...").
      validation.items = { itemType: "STRING", stringOptions: other ? {} : { enum: values } };
    } else if (!other) {
      validation.enum = values;
    }
  }
  if (spec.kind === "phone" && spec.countries?.length) validation.phoneOptions = { allowedCountryCodes: spec.countries };
  if (spec.kind === "file") {
    validation.fileLimit = spec.fileLimit ?? 1;
    if (spec.formats?.length) validation.uploadFileFormats = spec.formats;
  }
  // "Must be ticked" is the boolean enum [true]; `required` alone only checks that a value is present.
  if (spec.kind === "checkbox" && spec.required) validation.enum = [true];
  if (spec.kind === "address") {
    if (spec.countries?.length) validation.allowedCountries = spec.countries;
    validation.fields = Object.fromEntries(
      ADDRESS_PARTS.map((sub) => [sub, { required: spec.parts?.[sub] ?? (Boolean(spec.required) && ADDRESS_REQUIRED_WHEN_REQUIRED.includes(sub)) }]),
    );
  }

  // A checkbox labels itself with rich content (its label may carry a link to the terms).
  const component = { label: spec.kind === "checkbox" ? richText(spec.label) : spec.label, showLabel: true };
  if (spec.placeholder?.length > 100) {
    throw new Error(`field "${spec.label}": placeholder is ${spec.placeholder.length} characters, the API allows 100`);
  }
  if (spec.placeholder) component.placeholder = spec.placeholder;
  if (spec.description) component.description = richText(spec.description);
  if (options.length) component.options = options;
  if (other) component.customOption = other;
  // The prefill key differs per component: a checkbox has `checked`, a rating `defaultValue`,
  // a choice field marks its option (above), everything else `default`.
  if (spec.default != null && !isChoice) {
    if (spec.kind === "checkbox") component.checked = Boolean(spec.default);
    else if (spec.kind === "rating") component.defaultValue = Number(spec.default);
    else if (spec.kind === "number") component.default = Number(spec.default);
    else component.default = String(spec.default);
  }
  if (spec.kind === "phone" && spec.country) component.defaultCountryCode = spec.country;
  if (spec.kind === "file" && spec.buttonText) component.buttonText = spec.buttonText;
  if (spec.kind === "address" && spec.parts && "addressLine2" in spec.parts) component.fieldSettings = { addressLine2: { show: spec.parts.addressLine2 !== false } };

  return {
    id: randomUUID(),
    identifier: kind.identifier,
    fieldType: "INPUT",
    // A field a rule shows starts hidden.
    hidden: Boolean(spec.hidden),
    inputOptions: {
      target,
      inputType: kind.inputType,
      // `required` lives HERE, never inside the validation block.
      required: spec.required ?? false,
      // Contact fields carry pii and the CRM mapping; without contactMapping a submission is
      // stored but no contact is created or updated.
      ...(kind.contact ? { pii: true, contactMapping: kind.contact } : {}),
      [INPUT_BLOCK[kind.inputType]]: {
        // `validation` is always present, even as {}, and nests under the INPUT-TYPE block —
        // not the component one. Absent, the target is not registered as an accepted value and
        // every submission comes back UNKNOWN_VALUE_ERROR on a key that IS in the schema.
        validation,
        componentType: kind.componentType,
        [COMPONENT_BLOCK[kind.componentType]]: component,
      },
    },
  };
}

// Plan rule → v4 `formRules[]` entry. The condition names a field by LABEL; the override names
// the fields it shows / hides / requires. `show` marks those fields hidden in the base schema
// and un-hides them while the condition holds — how the dashboard's own "show X when" works.
const RULE_OPERATORS = { is: "EQUAL", isNot: "NOT_EQUAL", in: "IN", includes: "CONTAINS", checked: "CHECKED", isEmpty: "EMPTY", isNotEmpty: "NOT_EMPTY" };
function buildRule(rule, fieldByLabel, formName) {
  const byLabel = (label) => {
    const f = fieldByLabel.get(label);
    if (!f) throw new Error(`form "${formName}": rule refers to a field labelled "${label}" that is not in the plan`);
    return f;
  };
  const when = rule.when ?? {};
  const opKey = Object.keys(RULE_OPERATORS).find((k) => k in when);
  if (!when.field || !opKey) throw new Error(`form "${formName}": a rule needs "when": { "field", and one of ${Object.keys(RULE_OPERATORS).join("/")} }`);
  const source = byLabel(when.field);
  const operator = RULE_OPERATORS[opKey];
  // EMPTY, NOT_EMPTY and CHECKED carry no value of their own, but the service still requires one
  // (RULE_CONDITION_VALUE_MISSING without it); `true` is what the dashboard sends.
  const value = ["checked", "isEmpty", "isNotEmpty"].includes(opKey) ? true : when[opKey];
  const override = (label, propertyType, options) => ({
    entityType: "FIELD",
    fieldOptions: { fieldId: byLabel(label).id, propertyType, ...options },
  });
  const overrides = [
    ...(rule.show ?? []).map((l) => override(l, "HIDDEN", { hiddenOptions: { hidden: false } })),
    ...(rule.hide ?? []).map((l) => override(l, "HIDDEN", { hiddenOptions: { hidden: true } })),
    ...(rule.require ?? []).map((l) => override(l, "REQUIRED", { requiredOptions: { required: true } })),
  ];
  if (!overrides.length) throw new Error(`form "${formName}": a rule needs at least one of show / hide / require`);
  for (const l of rule.show ?? []) byLabel(l).hidden = true;
  return {
    id: randomUUID(),
    name: rule.name ?? `${when.field} ${opKey} ${JSON.stringify(value ?? "")}`.slice(0, 100),
    // The root of a rule expression must be an and/or group, never a bare condition
    // (UNGROUPED_RULE_EXPRESSION_ROOT). One condition still goes inside an `and`.
    expression: { and: { conditions: [{ condition: { target: source.inputOptions.target, operator, value } }] } },
    overrides,
  };
}

function buildForm(planForm) {
  const taken = new Set();
  const fields = (planForm.fields ?? []).map((f) => buildField(f, taken));
  if (!fields.length) throw new Error(`form "${planForm.name}": no fields`);
  const fieldByLabel = new Map(fields.map((f, i) => [planForm.fields[i].label, f]));

  const submit = {
    id: randomUUID(),
    identifier: "SUBMIT_BUTTON",
    fieldType: "DISPLAY",
    displayOptions: {
      // The button's identifier is SUBMIT_BUTTON; its display type is PAGE_NAVIGATION (the enum
      // has no SUBMIT_BUTTON value — the create is a 400 with anything else). One button drives
      // both the page moves and the final submit, so all three wordings sit on it.
      displayFieldType: "PAGE_NAVIGATION",
      pageNavigationOptions: {
        submitText: planForm.submitText ?? "Submit",
        ...(planForm.nextText ? { nextPageText: planForm.nextText } : {}),
        ...(planForm.previousText ? { previousPageText: planForm.previousText } : {}),
      },
    },
  };

  // `steps` must reference EVERY field, the submit button included — a field missing from the
  // layout never appears in the owner's dashboard, so they cannot edit what the site renders.
  // A plan without steps is one page; with steps, a field not named on any step lands on the
  // last one, and the button always does.
  const planSteps = planForm.steps?.length ? planForm.steps : [{ name: "", fields: planForm.fields.map((f) => f.label) }];
  const placed = new Set();
  const stepFields = planSteps.map((s) =>
    (s.fields ?? []).map((label) => {
      const f = fieldByLabel.get(label);
      if (!f) throw new Error(`form "${planForm.name}": step "${s.name ?? ""}" names a field labelled "${label}" that is not in the plan`);
      placed.add(f.id);
      return f;
    }),
  );
  const unplaced = fields.filter((f) => !placed.has(f.id));
  stepFields[stepFields.length - 1].push(...unplaced, submit);
  const layoutOf = (list) => {
    const items = list.map((f, i) => ({ fieldId: f.id, row: i, column: 0, width: 12 }));
    return { large: { items }, medium: { items }, small: { items } };
  };
  const steps = planSteps.map((s, i) => ({ id: randomUUID(), ...(s.name ? { name: s.name } : {}), layout: layoutOf(stepFields[i]) }));

  const formRules = (planForm.rules ?? []).map((r) => buildRule(r, fieldByLabel, planForm.name));

  // What happens after a successful submit is the owner's setting, so it lives on the form:
  // the thank-you text (optionally auto-hidden) or a redirect. Absent, the page writes its own.
  const submitSettings = planForm.redirect
    ? { submitSuccessAction: "REDIRECT", redirectOptions: { redirectUrl: planForm.redirect, target: "SELF" } }
    : planForm.thankYou
      ? { submitSuccessAction: "THANK_YOU_MESSAGE", thankYouMessageOptions: { richContent: richText(planForm.thankYou), ...(planForm.thankYouSeconds ? { durationInSeconds: planForm.thankYouSeconds } : {}) } }
      : null;
  const limitationRule = {
    ...(planForm.deadline ? { dateTimeDeadline: new Date(planForm.deadline).toISOString() } : {}),
    ...(planForm.maxSubmissions != null ? { maxAllowedSubmissions: planForm.maxSubmissions } : {}),
    ...(planForm.perVisitor != null ? { submissionLimitPerUser: planForm.perVisitor } : {}),
  };

  return {
    name: planForm.name,
    namespace: NAMESPACE,
    formFields: [...fields, submit],
    steps,
    ...(formRules.length ? { formRules } : {}),
    ...(submitSettings ? { submitSettings } : {}),
    ...(Object.keys(limitationRule).length ? { limitationRule } : {}),
    ...(planForm.requiredIndicator
      ? { requiredIndicatorProperties: { requiredIndicator: planForm.requiredIndicator, requiredIndicatorPlacement: "AFTER_FIELD_TITLE" } }
      : {}),
  };
}

// ---- operations ------------------------------------------------------------------------------

/**
 * Read the form back and confirm each field kept its componentType, and that the steps and rules
 * arrived. A create returns 200 even when a choice field degraded to a plain text box, so this is
 * the only check that catches it.
 */
async function verifyForm(ctx, formId, expected, body) {
  const { form } = await req(ctx, `/form-schema-service/v4/forms/${formId}`, { method: "GET" });
  const live = new Map(
    (form?.formFields ?? [])
      .filter((f) => f.fieldType === "INPUT")
      .map((f) => {
        const block = f.inputOptions?.[INPUT_BLOCK[f.inputOptions?.inputType]] ?? {};
        return [f.inputOptions?.target, block.componentType];
      }),
  );
  const degraded = expected
    .filter((e) => live.get(e.target) !== e.componentType)
    .map((e) => `${e.target}: expected ${e.componentType}, got ${live.get(e.target) ?? "MISSING"}`);
  const stepsLive = (form?.steps ?? []).length;
  const rulesLive = (form?.formRules ?? []).length;
  if (stepsLive !== body.steps.length) degraded.push(`steps: expected ${body.steps.length}, got ${stepsLive}`);
  if (rulesLive !== (body.formRules ?? []).length) degraded.push(`rules: expected ${(body.formRules ?? []).length}, got ${rulesLive}`);
  return { fieldsLive: live.size, steps: stepsLive, rules: rulesLive, degraded };
}

// ---- plan limits -----------------------------------------------------------------------------

/**
 * The caps the site's plan puts on forms, read live (Get Restrictions). A free site: 4 forms,
 * 10 input fields per form, 3 steps, 3 rules. A paid plan lifts them, so they are never
 * hardcoded here. Null when the call fails; the create then reports the cap itself.
 */
async function readLimits(ctx) {
  try {
    const { restrictions, totalFormCount } = await req(ctx, "/form-app-service/v4/restrictions", { method: "GET" });
    const limit = (key) => restrictions?.[key]?.limit;
    return {
      forms: limit("formsLimit"),
      fields: limit("fieldsLimit"),
      steps: limit("stepsLimit"),
      rules: limit("rulesLimit"),
      totalFormCount: totalFormCount ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Checks the whole plan against the site's caps BEFORE any create, so the agent fixes the plan
 * in one step instead of decoding the service's message one form at a time. The service rejects
 * the whole form (FIELDS_COUNT_RESTRICTIONS_ERROR and friends); nothing would be created either
 * way, but a local check costs no round trip.
 */
function checkPlanAgainstLimits(ctx, plan, byName, limits) {
  if (!limits) return;
  const over = (n, cap) => cap != null && n > cap;
  const problems = [];
  let newForms = 0;
  for (const f of plan.forms ?? []) {
    if (byName.has(f.name)) continue; // left as is, never counts twice
    newForms += 1;
    const fields = (f.fields ?? []).length;
    const steps = (f.steps ?? []).length;
    const rules = (f.rules ?? []).length;
    if (over(fields, limits.fields)) problems.push(`form "${f.name}": ${fields} fields, this site's plan allows ${limits.fields} per form`);
    if (over(steps, limits.steps)) problems.push(`form "${f.name}": ${steps} steps, this site's plan allows ${limits.steps} per form`);
    if (over(rules, limits.rules)) problems.push(`form "${f.name}": ${rules} rules, this site's plan allows ${limits.rules} per form`);
  }
  if (over(limits.totalFormCount + newForms, limits.forms)) {
    problems.push(
      `${newForms} new form(s) on top of the site's ${limits.totalFormCount} would exceed this site's plan limit of ${limits.forms} forms`,
    );
  }
  if (!problems.length) return;
  throw new Error(
    `The plan exceeds this site's plan limits; nothing was created:\n  - ${problems.join("\n  - ")}\n` +
      `Either trim the plan to the limits, or the owner upgrades the site's plan at ` +
      `https://www.wix.com/upgrade/website?metaSiteId=${ctx.siteId} and the same plan runs unchanged. ` +
      `Do not split one form in two to fit: it spends a form slot and splits a visitor's answers across two records. ` +
      `Say which way you went in the closing message.`,
  );
}

/**
 * Create every form in the plan. Existing forms are left alone — matching by name, since a
 * re-run must not create a second copy of the same form.
 */
export async function setupForms(ctx, plan) {
  await installFormsApp(ctx);

  const existing = await req(
    ctx,
    `/form-schema-service/v4/forms?namespace=${encodeURIComponent(NAMESPACE)}`,
    { method: "GET" },
  ).catch(() => ({ forms: [] }));
  const byName = new Map((existing.forms ?? []).map((f) => [f.name, f]));

  // Every form is built first, so a plan mistake (a bad kind, a rule naming an unknown field, a
  // placeholder over 100 characters) surfaces before any call; then the site's caps are checked.
  const bodies = new Map((plan.forms ?? []).filter((f) => !byName.has(f.name)).map((f) => [f.name, buildForm(f)]));
  checkPlanAgainstLimits(ctx, plan, byName, await readLimits(ctx));

  const out = [];
  for (const planForm of plan.forms ?? []) {
    const already = byName.get(planForm.name);
    if (already) {
      out.push({
        name: planForm.name,
        formId: already.id ?? already._id,
        created: false,
        fields: (already.formFields ?? [])
          .filter((f) => f.fieldType === "INPUT")
          .map((f) => ({ target: f.inputOptions?.target, label: planForm.name })),
      });
      continue;
    }

    const body = bodies.get(planForm.name);
    let form;
    try {
      ({ form } = await req(ctx, "/form-schema-service/v4/forms", { body: { form: body } }));
    } catch (e) {
      // Verified live: a `file` field on a site whose plan does not include file uploads fails the
      // whole create with this code — nothing is created. There is no API switch for it; the owner
      // upgrades the site's plan, or the form drops the `file` kind (see SEED.md, "Kinds").
      if (String(e.message).includes("FILE_UPLOAD_RESTRICTIONS_ERROR")) {
        const names = planForm.fields.filter((f) => f.kind === "file").map((f) => `"${f.label}"`).join(", ");
        throw new Error(
          `form "${planForm.name}": this site's plan does not allow file-upload fields (${names}) — ` +
          `FILE_UPLOAD_RESTRICTIONS_ERROR; Wix Forms gates the file field behind a paid site plan and nothing was created. ` +
          `Either the owner upgrades the site in the dashboard, or replace the field with a "url" kind and let the site ` +
          `upload the file itself through the shared mediaUpload capability (plan.capabilities.mediaUpload, Astro only), ` +
          `submitting the uploaded file's URL. Tell the owner which one you did.`,
        );
      }
      throw e;
    }
    const formId = form?.id ?? form?._id;
    if (!formId) throw new Error(`form "${planForm.name}": created but no id returned`);

    const expected = body.formFields
      .filter((f) => f.fieldType === "INPUT")
      .map((f) => ({
        target: f.inputOptions.target,
        componentType: f.inputOptions[INPUT_BLOCK[f.inputOptions.inputType]].componentType,
      }));
    const check = await verifyForm(ctx, formId, expected, body);

    out.push({
      name: planForm.name,
      formId,
      created: true,
      fields: body.formFields
        .filter((f) => f.fieldType === "INPUT")
        .map((f, i) => ({ target: f.inputOptions.target, label: planForm.fields[i].label })),
      ...check,
    });
  }
  return { forms: out };
}

// ---- CLI entry -------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("usage: node seed-forms.mjs <plan.json>   (run from the project root)");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const ctx = makeCtx();
  setupForms(ctx, plan)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
