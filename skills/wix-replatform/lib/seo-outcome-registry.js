'use strict';

// Every product-SEO stage outcome, in one frozen place that both the SEO stage
// (rp-target-wix/lib/product-seo.js) and the completion report import, so the stage cannot
// report a code the report has no line for (the same reason payments-outcome-registry.js exists).

// Rows with any of these outcomes keep the run from reporting product SEO complete.
const SEO_BLOCKING_OUTCOMES = Object.freeze([
  'seo_disposition_required',
  'focus_keywords_disposition_required',
  'canonical_pending_policy',
  'seo_write_unverified',
  'seo_inheritance_unverified',
  'seo_resolution_unverified',
  'seo_conflict',
]);

// Owner-dispositioned or owner-kept outcomes. They stay visible in the final report as counts,
// but they are decisions the owner made, not open work, so they do not block completion.
const SEO_ACCEPTED_OUTCOMES = Object.freeze([
  'seo_disposition_accepted_gap',
  'seo_materialized',
  'focus_keywords_accepted_gap',
  'seo_conflict_kept_wix',
]);

const SEO_OUTCOMES = Object.freeze([...SEO_BLOCKING_OUTCOMES, ...SEO_ACCEPTED_OUTCOMES]);

// What the owner or operator does next, per outcome. Rendered by the completion report instead
// of the generic "re-run the stage" line, because most of these need a decision, not a retry.
const SEO_OUTCOME_ACTIONS = Object.freeze({
  seo_disposition_required: 'Product SEO is held: the source shows SEO for these products but cannot prove which fields the merchant overrode. Supply the raw Yoast evidence, or choose omit (inherit Wix patterns and record the loss) or materialize (write the rendered title/description as item overrides).',
  focus_keywords_disposition_required: 'Yoast focus keyphrases have no verified Wix product write path. Supply evidence of a verified path later, or accept the loss (omit) for these products.',
  canonical_pending_policy: 'These products carry a canonical URL that is not their own source permalink. It is not written until an approved canonical policy is supplied.',
  seo_write_unverified: 'A product SEO write did not read back as an item override. The next run reconciles that write from its journal and read-back; it is never re-sent blindly.',
  seo_inheritance_unverified: 'A field that should inherit Wix\'s pattern still has an item-level tag. No write happened; the next run re-verifies. The stray tag is removed only through a partial update or when the owner asks.',
  seo_resolution_unverified: 'Wix resolved SEO tags could not be read for these products. The next run re-verifies them.',
  seo_conflict: 'These products changed in Wix since the last import. Choose override (write the source SEO over the Wix edit) or keep (leave the Wix values).',
  seo_disposition_accepted_gap: 'The owner chose omit: these products inherit Wix SEO patterns and the source overrides are an accepted loss.',
  seo_materialized: 'The owner chose materialize: the rendered source title/description were written as item overrides.',
  focus_keywords_accepted_gap: 'The owner accepted the loss of Yoast focus keyphrases for these products.',
  seo_conflict_kept_wix: 'The owner chose to keep the Wix SEO values for these products over the source values.',
});

module.exports = { SEO_BLOCKING_OUTCOMES, SEO_ACCEPTED_OUTCOMES, SEO_OUTCOMES, SEO_OUTCOME_ACTIONS };
