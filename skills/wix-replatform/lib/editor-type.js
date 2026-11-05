'use strict';

// The one reader of `GET /editor-urls`: the destination step and setup both ask a site which
// editor it opens in, and both parse the answer here so the two can never disagree about what a
// malformed answer is.
// null = no string editor type in the answer; an empty string is returned as is (callers that need a
// usable type treat it as unknown).
function editorTypeFromUrls(json) {
  const urls = json && typeof json === 'object' ? json.urls : null;
  return urls && typeof urls.editorType === 'string' ? urls.editorType : null;
}

// The editor type of a Harmony (Wix Harmony / ODE) site, as `GET /editor-urls` names it.
const HARMONY_EDITOR_TYPE = 'ODEDITOR';

module.exports = { editorTypeFromUrls, HARMONY_EDITOR_TYPE };
