// Forms seed — a BUILD-TIME script, never shipped in the app. Run from the project root
// (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/references/forms/seed/seed-forms.mjs plan.json
//
// It mints its own site token via the Wix CLI, installs the Wix Forms app if needed, expands
// each plan field into the nested Form Schemas v4 shape, creates the forms, and READS EACH ONE
// BACK to prove the fields survived (a create returns 200 even when a choice field silently
// degraded to a plain text box). Prints a JSON result to stdout.
//
// Plan shape (see SEED.md):
//   { "forms": [{ "name", "submitText"?, "fields": [
//       { "label", "kind", "required"?, "placeholder"?, "choices"?, "min"?, "max"? } ] }] }
//
// The plan is PLAIN DATA — labels and kinds. Everything the API demands and the docs bury is
// derived here: per-field UUIDs, the two-level options nesting, the validation block that must
// exist even when empty, the choice enum that must agree with the component's options, the
// snake_case+suffix target, and a `steps` layout referencing every field including the submit
// button (a field missing from `steps` never appears in the owner's dashboard).
//
// Seeding is ADDITIVE — never deletes or overwrites existing forms.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const API = "https://www.wixapis.com";
const FORMS_APP_ID = "225dd912-7dea-4738-8688-4b8c6955ffc2";
const NAMESPACE = "wix.form_app.form";

export function makeCtx({ cwd = process.cwd() } = {}) {
  const config = JSON.parse(readFileSync(`${cwd}/wix.config.json`, "utf8"));
  const siteId = config.siteId ?? config.projectId;
  if (!siteId) throw new Error("wix.config.json has no siteId — is this a Wix CLI project?");
  const token = execFileSync("npx", ["@wix/cli@latest", "token", "--site", siteId], {
    encoding: "utf8",
    cwd,
  }).trim();
  if (!token) throw new Error("The Wix CLI returned no token — run `npx @wix/cli@latest login` first.");
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

// kind → { inputType, componentType, identifier, block, componentBlock, format? }
// The two block names are what the API nests settings under, and they are named after the
// field's own enums — which is why they are looked up here rather than spelled at each call.
const KINDS = {
  text:      { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "TEXT_INPUT" },
  textarea:  { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "TEXT_AREA" },
  email:     { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "CONTACTS_EMAIL", format: "EMAIL" },
  phone:     { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "CONTACTS_PHONE", format: "PHONE" },
  url:       { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "URL_INPUT", format: "URL" },
  firstName: { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "CONTACTS_FIRST_NAME" },
  lastName:  { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "CONTACTS_LAST_NAME" },
  company:   { inputType: "STRING", componentType: "TEXT_INPUT",     identifier: "CONTACTS_COMPANY" },
  date:      { inputType: "STRING", componentType: "DATE_PICKER",    identifier: "DATE_PICKER", format: "DATE" },
  number:    { inputType: "NUMBER", componentType: "NUMBER_INPUT",   identifier: "NUMBER_INPUT" },
  rating:    { inputType: "NUMBER", componentType: "RATING_INPUT",   identifier: "RATING_INPUT" },
  select:    { inputType: "STRING", componentType: "DROPDOWN",       identifier: "DROPDOWN" },
  radio:     { inputType: "STRING", componentType: "RADIO_GROUP",    identifier: "RADIO_GROUP" },
  multi:     { inputType: "ARRAY",  componentType: "CHECKBOX_GROUP", identifier: "CHECKBOX_GROUP" },
  checkbox:  { inputType: "BOOLEAN", componentType: "CHECKBOX",      identifier: "CHECKBOX" },
  file:      { inputType: "WIX_FILE", componentType: "FILE_UPLOAD",  identifier: "FILE_UPLOAD" },
  address:   { inputType: "ADDRESS", componentType: "MULTILINE_ADDRESS", identifier: "MULTILINE_ADDRESS" },
};

const INPUT_BLOCK = {
  STRING: "stringOptions", NUMBER: "numberOptions", BOOLEAN: "booleanOptions",
  ARRAY: "arrayOptions", ADDRESS: "addressOptions", WIX_FILE: "wixFileOptions",
};
const COMPONENT_BLOCK = {
  TEXT_INPUT: "textInputOptions", NUMBER_INPUT: "numberInputOptions",
  RATING_INPUT: "ratingInputOptions", DATE_PICKER: "datePickerOptions",
  CHECKBOX: "checkboxOptions", CHECKBOX_GROUP: "checkboxGroupOptions",
  RADIO_GROUP: "radioGroupOptions", DROPDOWN: "dropdownOptions",
  MULTILINE_ADDRESS: "multilineAddressOptions", FILE_UPLOAD: "fileUploadOptions",
};

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
  const choices = spec.choices ?? [];
  if ((spec.kind === "select" || spec.kind === "radio" || spec.kind === "multi") && !choices.length) {
    throw new Error(`field "${spec.label}": kind "${spec.kind}" needs a non-empty choices array`);
  }

  const target = targetFor(spec.label, taken);
  const options = choices.map((c) => {
    const value = typeof c === "string" ? c : c.value;
    return { id: randomUUID(), label: typeof c === "string" ? c : (c.label ?? c.value), value };
  });
  const values = options.map((o) => o.value);

  // A choice field declares its options TWICE — here and in the validation enum — and the two
  // must agree. Disagree and the create still returns 200: the field is created as a plain
  // text box, losing its choices. Both are derived from the same list, so they cannot drift.
  const validation = {};
  if (kind.format) validation.format = kind.format;
  if (spec.min != null) validation.minimum = spec.min;
  if (spec.max != null) validation.maximum = spec.max;
  if (spec.maxLength != null) validation.maxLength = spec.maxLength;
  if (values.length) {
    if (kind.inputType === "ARRAY") {
      validation.itemType = "STRING";
      validation.items = { stringOptions: { enum: values } };
    } else {
      validation.enum = values;
    }
  }
  if (spec.kind === "file") validation.fileLimit = spec.fileLimit ?? 1;

  const component = { label: spec.label, showLabel: true };
  if (spec.placeholder) component.placeholder = spec.placeholder;
  if (options.length) component.options = options;
  if (spec.kind === "textarea") component.numberOfLines = spec.lines ?? 4;
  if (spec.default != null) component.default = spec.default;

  return {
    id: randomUUID(),
    identifier: kind.identifier,
    fieldType: "INPUT",
    inputOptions: {
      target,
      inputType: kind.inputType,
      // `required` lives HERE, never inside the validation block.
      required: spec.required ?? false,
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

function buildForm(planForm) {
  const taken = new Set();
  const fields = (planForm.fields ?? []).map((f) => buildField(f, taken));
  if (!fields.length) throw new Error(`form "${planForm.name}": no fields`);

  const submit = {
    id: randomUUID(),
    identifier: "SUBMIT_BUTTON",
    fieldType: "DISPLAY",
    displayOptions: {
      displayFieldType: "SUBMIT_BUTTON",
      pageNavigationOptions: { submitText: planForm.submitText ?? "Submit" },
    },
  };

  // `steps` must reference EVERY field, the submit button included — a field missing from the
  // layout never appears in the owner's dashboard, so they cannot edit what the site renders.
  const items = [...fields, submit].map((f, i) => ({
    fieldId: f.id,
    row: i,
    column: 0,
    width: 12,
  }));

  return {
    name: planForm.name,
    namespace: NAMESPACE,
    formFields: [...fields, submit],
    steps: [{ id: randomUUID(), layout: { large: { items }, medium: { items }, small: { items } } }],
  };
}

// ---- operations ------------------------------------------------------------------------------

/**
 * Read the form back and confirm each field kept its componentType. A create returns 200 even
 * when a choice field degraded to a plain text box, so this is the only check that catches it.
 */
async function verifyForm(ctx, formId, expected) {
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
  return { fieldsLive: live.size, degraded };
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

    const body = buildForm(planForm);
    const { form } = await req(ctx, "/form-schema-service/v4/forms", { body: { form: body } });
    const formId = form?.id ?? form?._id;
    if (!formId) throw new Error(`form "${planForm.name}": created but no id returned`);

    const expected = body.formFields
      .filter((f) => f.fieldType === "INPUT")
      .map((f) => ({
        target: f.inputOptions.target,
        componentType: f.inputOptions[INPUT_BLOCK[f.inputOptions.inputType]].componentType,
      }));
    const check = await verifyForm(ctx, formId, expected);

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
