'use strict';

const VALID_CSV = [
  'meta_key,label,type,section,required,options,enabled,sort_order',
  'gift_message,"Gift ""message""",textarea,additional,no,,yes,10',
  'delivery_instructions,Delivery instructions,text,additional,no,,yes,20',
  'preferred_contact_method,Preferred contact method,radio,additional,yes,"Email|Phone|SMS",yes,30',
  'section_heading,Additional details,heading,additional,no,,yes,5',
].join('\n');

const BAD_CSV_DUPLICATE_KEY = [
  'meta_key,label,type,section,required,options,enabled,sort_order',
  'gift_message,Gift message,textarea,additional,no,,yes,10',
  'gift_message,Gift message again,text,additional,no,,yes,20',
].join('\n');

const BAD_CSV_MISSING_OPTIONS = [
  'meta_key,label,type,section,required,options,enabled,sort_order',
  'preferred_contact_method,Preferred contact method,radio,additional,yes,,yes,30',
].join('\n');

const BAD_CSV_UNTERMINATED_QUOTE = [
  'meta_key,label,type,section,required,options,enabled,sort_order',
  'gift_message,"Gift message,textarea,additional,no,,yes,10',
].join('\n');

const BAD_CSV_INVALID_REQUIRED = [
  'meta_key,label,type,section,required,options,enabled,sort_order',
  'gift_message,Gift message,textarea,additional,yse,,yes,10',
].join('\n');

const BAD_CSV_INVALID_ENABLED = [
  'meta_key,label,type,section,required,options,enabled,sort_order',
  'gift_message,Gift message,textarea,additional,no,,maybe,10',
].join('\n');

const BAD_CSV_INVALID_SORT_ORDER = [
  'meta_key,label,type,section,required,options,enabled,sort_order',
  'gift_message,Gift message,textarea,additional,no,,yes,abc',
].join('\n');

// `parse` here is the handler's real entry point — parse({ inputPath, readFile }) — the exact
// shape blocked-data-requests.js's attemptFulfillment() calls, not the internal pure text
// parser, so this self-test actually exercises the contract a real resolveBlockedDataRequest()
// run depends on.
async function selfTest(parse) {
  const readFile = (csvByPath) => async (inputPath) => {
    if (!(inputPath in csvByPath)) throw new Error(`fixture readFile: no CSV registered for ${inputPath}`);
    return csvByPath[inputPath];
  };

  const valid = await parse({ inputPath: '/fake/valid.csv', readFile: readFile({ '/fake/valid.csv': VALID_CSV }) });
  if (!valid.reconciled) throw new Error('fixture: valid CSV did not reconcile');
  if (!Number.isInteger(valid.expectedTotal) || valid.sourceCount !== valid.expectedTotal) {
    throw new Error('fixture: sourceCount/expectedTotal must be present and equal for a fully-read CSV');
  }
  if (valid.headingCount !== 1) throw new Error('fixture: heading row was not counted separately');
  if (valid.fields.length !== 3) throw new Error('fixture: expected 3 non-heading fields');
  if (valid.fields[0].label !== 'Gift "message"') {
    throw new Error(`fixture: escaped double-quote in a quoted label was not unescaped correctly, got ${JSON.stringify(valid.fields[0].label)}`);
  }
  const contactMethod = valid.fields.find((field) => field.metaKey === 'preferred_contact_method');
  if (!contactMethod || contactMethod.options.length !== 3 || contactMethod.options[1] !== 'Phone') {
    throw new Error('fixture: pipe-delimited options did not parse correctly');
  }
  if (valid.fields.find((field) => field.fieldType === 'heading')) {
    throw new Error('fixture: heading row leaked into the returned field list');
  }

  const duplicate = await parse({ inputPath: '/fake/dup.csv', readFile: readFile({ '/fake/dup.csv': BAD_CSV_DUPLICATE_KEY }) });
  if (duplicate.reconciled) throw new Error('fixture: duplicate meta_key should not reconcile');

  const missingOptions = await parse({ inputPath: '/fake/missing-options.csv', readFile: readFile({ '/fake/missing-options.csv': BAD_CSV_MISSING_OPTIONS }) });
  if (missingOptions.reconciled) throw new Error('fixture: choice-type row with no options should not reconcile');

  const unterminated = await parse({ inputPath: '/fake/unterminated.csv', readFile: readFile({ '/fake/unterminated.csv': BAD_CSV_UNTERMINATED_QUOTE }) });
  if (unterminated.reconciled) throw new Error('fixture: an unterminated quote must not reconcile, not be silently mis-split');

  const invalidRequired = await parse({ inputPath: '/fake/invalid-required.csv', readFile: readFile({ '/fake/invalid-required.csv': BAD_CSV_INVALID_REQUIRED }) });
  if (invalidRequired.reconciled) throw new Error('fixture: required="yse" (not yes/no) must not reconcile — must not silently coerce to false');

  const invalidEnabled = await parse({ inputPath: '/fake/invalid-enabled.csv', readFile: readFile({ '/fake/invalid-enabled.csv': BAD_CSV_INVALID_ENABLED }) });
  if (invalidEnabled.reconciled) throw new Error('fixture: enabled="maybe" (not yes/no) must not reconcile — must not silently coerce to false');

  const invalidSortOrder = await parse({ inputPath: '/fake/invalid-sort-order.csv', readFile: readFile({ '/fake/invalid-sort-order.csv': BAD_CSV_INVALID_SORT_ORDER }) });
  if (invalidSortOrder.reconciled) throw new Error('fixture: sort_order="abc" (not a number) must not reconcile — must not silently coerce to 0');

  return true;
}

module.exports = selfTest;
