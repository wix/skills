'use strict';

// One source of truth for mapping/execution approval choice ids.
// Requests offer the canonical ids; answers may also use the older aliases
// (approve / declined / reject) that earlier requests offered.
const CHOICES = Object.freeze([
  Object.freeze({ id: 'approved', label: 'Approve', description: 'Accept the reviewed scope and continue.' }),
  Object.freeze({ id: 'rejected', label: 'Request changes', description: 'Stay at this stage until the listed issues are resolved.' }),
]);

const STATUS_BY_CHOICE = Object.freeze({
  approved: 'approved',
  approve: 'approved',
  rejected: 'rejected',
  declined: 'rejected',
  reject: 'rejected',
});

// 'approved' | 'rejected' | null for an unknown id.
function approvalStatus(choice) {
  return Object.hasOwn(STATUS_BY_CHOICE, choice) ? STATUS_BY_CHOICE[choice] : null;
}

// Approval requests with no choices get the canonical pair; declared ids must all be known,
// so every offered answer can be applied.
function approvalChoices(choices) {
  if (!Array.isArray(choices) || choices.length === 0) return CHOICES.map((choice) => ({ ...choice }));
  const unknown = choices.filter((choice) => !approvalStatus(choice && choice.id)).map((choice) => choice && choice.id);
  if (unknown.length) throw new Error(`approval choice ids must be approved or rejected; got ${unknown.join(', ')}`);
  return choices;
}

module.exports = { CHOICES, approvalStatus, approvalChoices };
