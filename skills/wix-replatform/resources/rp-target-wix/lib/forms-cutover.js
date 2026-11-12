'use strict';

// The forms import's cutover items, in the two durable shapes cutover reads today:
// structured completion-report `operatorActions` (merge by `code` into createCompletionReport()
// input; copied to execution/review/migration-handoff.json) and migration-review/1 tasks in
// group Manual, requirement optional, each dismissable with its consequence acknowledgment. The
// generated importer collects the ids while it writes. Ids only; no form names, field values or
// submitter details.

const PAUSE_LEDGER = 'execution/forms/automation-pause.json';
const CMS_OVERRIDE = 'mappingTargetOverride:content.form-submissions=cms';

const ACTIONS = Object.freeze({
  notificationEmailFormIds: {
    code: 'form-notification-email-not-migrated', severity: 'medium', entity: 'forms/form',
    action: 'The source form sent owner or submitter emails; those templates do not carry over. In Wix Forms → Automations, set each listed form\'s emails as the merchant wants them, or dismiss.',
    consequence: 'New entries send no email, or only Wix\'s default one, until this is set up.',
    deadlineReason: 'After the form exists; before the DNS switch.',
    resolutionEvidence: 'The operator resolves it after setting the emails, or dismisses it accepting the consequence.',
  },
  logicFormIds: {
    code: 'form-logic-not-migrated', severity: 'medium', entity: 'forms/form',
    action: 'The source form had conditional rules; they do not carry over. Rebuild them in the Wix form editor for each listed form, or dismiss.',
    consequence: 'Every field of these forms always shows.',
    deadlineReason: 'After the form exists; before the DNS switch.',
    resolutionEvidence: 'The operator resolves it after rebuilding the rules, or dismisses it.',
  },
  recreatedFormIds: {
    code: 'form-not-on-page', severity: 'high', entity: 'forms/form',
    action: 'Place each listed form on its page (website copy or the Wix editor). The import creates the form; it does not put it on a page.',
    consequence: 'Visitors cannot submit these forms until they are on a page.',
    deadlineReason: 'After the website build; before the DNS switch.',
    resolutionEvidence: 'The public page shows the form.',
  },
  cmsArchivedFormIds: {
    code: 'form-entries-archived-in-cms', severity: 'low', entity: 'cms/data-item',
    action: 'The operator chose a private CMS archive for these forms\' old entries. They are in the CMS collection, not the Wix Forms inbox. Review; dismiss if fine.',
    consequence: 'Old entries are in CMS, not in the Forms inbox.',
    deadlineReason: 'At cutover.',
    resolutionEvidence: 'The operator dismisses it.',
  },
  inSpamEntryIds: {
    code: 'form-entries-in-spam', severity: 'medium', entity: 'forms/form-submission',
    action: 'Wix\'s spam filter moved these imported entries to the form\'s spam tab. In Wix Forms → spam tab, restore the real ones, or dismiss. Restoring runs the form\'s automations like a new entry, so do it after the form\'s emails are set as wanted.',
    consequence: 'These old entries are not in the Forms inbox.',
    deadlineReason: 'After the import is done.',
    resolutionEvidence: 'The entries are restored, or the operator dismisses it.',
  },
  sourceSpamExcludedEntryIds: {
    code: 'form-entries-source-spam-excluded', severity: 'low', entity: 'forms/form-submission',
    action: 'The source plugin flagged these entries as spam, so they were excluded (exclusions[] rows). Review the exclusion; dismiss if fine.',
    consequence: 'These entries are not migrated.',
    deadlineReason: 'At cutover.',
    resolutionEvidence: 'The operator dismisses it.',
  },
  datesInHiddenFieldFormIds: {
    code: 'form-entry-dates-in-hidden-field', severity: 'low', entity: 'forms/form-submission',
    action: 'Wix shows the import date as each imported entry\'s date. The original date is in the hidden "Original submission date" field of each listed form. Review; dismiss if fine.',
    consequence: 'The Forms inbox shows the import date, not the original date.',
    deadlineReason: 'At cutover.',
    resolutionEvidence: 'The operator dismisses it.',
  },
});

const ids = (values) => [...new Set((values || []).map(String))].sort();
const automationIds = (rows) => ids((rows || []).map(row => row.automationId || row.currentId || row.originalId).filter(Boolean));
const formIdsOf = (rows) => ids((rows || []).map(row => row.formId).filter(Boolean));

// input: { notificationEmailFormIds, logicFormIds, recreatedFormIds, cmsArchivedFormIds,
//   inSpamEntryIds, deletedBySpamEntries: [{ formId, id }], sourceSpamExcludedEntryIds,
//   automationsNotPaused: [{ formId, automationId }], automationsNotRestored: [{ formId, currentId }],
//   spamFilterNotRestored: [{ formId, levelBefore }], pauseLedgerUnreadable: [{ formId }],
//   datesInHiddenFieldFormIds }
function formsOperatorActions(input = {}) {
  const rows = [];
  for (const [field, template] of Object.entries(ACTIONS)) {
    const affected = ids(input[field]);
    if (!affected.length) continue;
    const { consequence, ...row } = template;
    rows.push({ ...row, actionId: template.code, role: 'cutover-operator', affectedCount: affected.length, affectedIds: affected });
  }
  const deleted = input.deletedBySpamEntries || [];
  if (deleted.length) {
    const forms = formIdsOf(deleted);
    rows.push({
      code: 'form-entries-in-spam', actionId: 'form-entries-in-spam:deleted', severity: 'high', entity: 'forms/form-submission', role: 'import-operator',
      action: 'Requires Import Operator: Wix\'s spam filter removed these imported entries and kept no spam copy, so they are not on the site.',
      importOperatorPrompt: `Re-import the listed form entries for form ${forms.map(id => `\`${id}\``).join(', ')} to the private CMS archive with \`${CMS_OVERRIDE}\` and resume the forms task.`,
      deadlineReason: 'After the import is done; before cutover.',
      affectedCount: ids(deleted.map(row => row.id)).length, affectedIds: ids(deleted.map(row => row.id)),
      resolutionEvidence: 'The entries are archived in CMS and read back, or the operator dismisses the loss.',
    });
  }
  const notPaused = input.automationsNotPaused || [];
  if (notPaused.length) {
    rows.push({
      code: 'form-automations-not-paused', actionId: 'form-automations-not-paused', severity: 'low', entity: 'forms/form-submission', role: 'cutover-operator',
      action: `The import could not pause the submission automations of form ${formIdsOf(notPaused).map(id => `\`${id}\``).join(', ')}, and imported its entries anyway. The owner may have received one email per imported entry for that form. Review; dismiss if fine.`,
      deadlineReason: 'At cutover.', affectedCount: automationIds(notPaused).length || formIdsOf(notPaused).length,
      affectedIds: automationIds(notPaused).length ? automationIds(notPaused) : formIdsOf(notPaused), artifactRefs: [PAUSE_LEDGER],
      resolutionEvidence: 'The operator dismisses it.',
    });
  }
  const notRestored = input.automationsNotRestored || [];
  if (notRestored.length) {
    rows.push({
      code: 'form-automations-not-restored', actionId: 'form-automations-not-restored', severity: 'high', entity: 'forms/form-submission', role: 'cutover-operator',
      action: `The import paused these submission automations of form ${formIdsOf(notRestored).map(id => `\`${id}\``).join(', ')} and could not turn them back on. In Wix → Automations, turn each listed automation back on (ids below; ${PAUSE_LEDGER} names each), or have the Import Operator resume the restore.`,
      importOperatorPrompt: `Requires Import Operator: resume the forms task in the original migration project; it restores every automation in ${PAUSE_LEDGER} that has no restoredAt to its statusBefore and reads it back.`,
      deadlineReason: 'Before the DNS switch: until then new visitor entries send no email.', affectedCount: automationIds(notRestored).length,
      affectedIds: automationIds(notRestored), artifactRefs: [PAUSE_LEDGER],
      resolutionEvidence: 'A read-back shows each automation in its recorded statusBefore (restoredAt set in the ledger).',
    });
  }
  const spamNotRestored = input.spamFilterNotRestored || [];
  if (spamNotRestored.length) {
    const forms = formIdsOf(spamNotRestored);
    const levels = [...new Set(spamNotRestored.map(row => row.levelBefore || 'ADVANCED'))].join(' / ');
    rows.push({
      code: 'form-spam-filter-not-restored', actionId: 'form-spam-filter-not-restored', severity: 'high', entity: 'forms/form', role: 'cutover-operator',
      action: `The import lowered the spam filter of form ${forms.map(id => `\`${id}\``).join(', ')} to None while it wrote the old entries and could not set it back. In Wix Forms → the form's settings → spam protection, set it back to ${levels} (${PAUSE_LEDGER} records each form's level before).`,
      deadlineReason: 'Before the form is on a public page: until then visitor spam is not filtered.', affectedCount: forms.length,
      affectedIds: forms, artifactRefs: [PAUSE_LEDGER],
      resolutionEvidence: 'A read-back of each form shows its recorded spam protection level.',
    });
  }
  // With the ledger unreadable, an automation an EARLIER stopped run left off reads as INACTIVE and
  // has no row to restore: only the operator can tell it should be on.
  const ledgerForms = formIdsOf(input.pauseLedgerUnreadable);
  if (ledgerForms.length) {
    rows.push({
      code: 'form-pause-ledger-unreadable', actionId: 'form-pause-ledger-unreadable', severity: 'high', entity: 'forms/form-submission', role: 'cutover-operator',
      action: `The import could not read its pause record (${PAUSE_LEDGER}) for form ${ledgerForms.map(id => `\`${id}\``).join(', ')}, so it cannot tell whether an earlier run left this form's submission automations off or its spam filter lowered. In Wix → Automations, check that the form's "New submission received" and "Receive notification when a form is submitted" automations are on, and in Wix Forms → the form's settings, that spam protection is set.`,
      deadlineReason: 'Before the DNS switch: an automation left off sends no email for new visitor entries.', affectedCount: ledgerForms.length,
      affectedIds: ledgerForms, artifactRefs: [PAUSE_LEDGER],
      resolutionEvidence: 'The operator confirms both automations are on and spam protection is set, or dismisses it.',
    });
  }
  return rows;
}

const CONSEQUENCES = Object.freeze({
  ...Object.fromEntries(Object.values(ACTIONS).map(t => [t.code, t.consequence])),
  'form-entries-in-spam:deleted': 'These old entries are lost from the site unless they are re-imported to the CMS archive.',
  'form-automations-not-paused': 'The owner may have received one email per imported entry for that form.',
  'form-automations-not-restored': 'New visitor entries of these forms send no email until the automations are on again.',
  'form-spam-filter-not-restored': 'Visitor spam to these forms is not filtered until the level is set back.',
  'form-pause-ledger-unreadable': 'An automation an earlier run left off may stay off: new visitor entries of the form send no email.',
});

// The same items as migration-review/1 tasks: group Manual, requirement optional, dismissable
// with the consequence as the acknowledgment.
function formsReviewTasks(input = {}, { scopeKey = 'forms' } = {}) {
  return formsOperatorActions(input).map(row => {
    const consequence = CONSEQUENCES[row.actionId];
    return {
      findingKey: row.actionId, scopeKey, group: 'Manual', requirement: 'optional',
      title: row.actionId, summary: row.action, consequence, action: row.importOperatorPrompt && row.role === 'import-operator' ? `${row.action} ${row.importOperatorPrompt}` : row.action,
      affected: row.affectedIds || [], affectedCount: row.affectedCount, prerequisites: [], verificationPolicy: 'manual', evidenceStatus: 'needs_attention',
      dismissalAcknowledgment: consequence,
    };
  });
}

module.exports = {
  formsOperatorActions,
  formsReviewTasks,
  FORMS_OPERATOR_ACTION_CODES: Object.freeze([...new Set([...Object.values(ACTIONS).map(row => row.code), 'form-automations-not-paused', 'form-automations-not-restored', 'form-spam-filter-not-restored', 'form-pause-ledger-unreadable'])]),
};
