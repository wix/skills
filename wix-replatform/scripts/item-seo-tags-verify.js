#!/usr/bin/env node
'use strict';

// Spec 0056, Goal 2: the first live, end-to-end exercise of the seo/item-seo-tags write
// path. Reads a WordPress post already seeded with a genuine Yoast override (see
// scripts/test-site-seed/seed-plugin-data.mjs's 'seo' section), maps it to the Item SEO
// Tags shape per rp-target-wix/domains/seo/entities/item-seo-tags.json's mappingGuidance,
// creates a throwaway Wix Blog post to get a real itemId, writes the mapped tags via Bulk
// Set Item SEO Tags, reads them back to confirm they resolved with TAG_SOURCE_ITEM, and —
// on every exit path, success or failure — deletes the throwaway post. If cleanup itself
// fails, the retained itemId is printed rather than swallowed (spec 0056 Decision 4).
//
// Usage:
//   node skills/wix-replatform/scripts/item-seo-tags-verify.js \
//     --wp-env <path to source.wordpress.env> \
//     --wix-env <path to target.wix.env> \
//     --wp-post-id <numeric WordPress post id already seeded with an override> \
//     [--keep]   # skip cleanup, print the retained itemId instead (debugging only)

const { readEnvFile } = require('../lib/config-env.js');
const {
  createWixClient,
  createDraftPost,
  publishDraftPost,
  deleteDraftPost,
  listMembers,
} = require('../resources/rp-target-wix/lib/wix-writers.js');

const WIXAPIS = 'https://www.wixapis.com';

function usage() {
  return [
    'Usage: node skills/wix-replatform/scripts/item-seo-tags-verify.js',
    '  --wp-env <path>       source.wordpress.env (WP_BASE_URL, WP_USERNAME, WP_APPLICATION_PASSWORD)',
    '  --wix-env <path>      target.wix.env (WIX_SITE_ID, WIX_API_KEY)',
    '  --wp-post-id <id>     WordPress post id already seeded with a genuine Yoast override',
    '  [--keep]              skip cleanup; print the retained itemId instead of deleting it',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--wp-env') args.wpEnvFile = argv[++i];
    else if (token === '--wix-env') args.wixEnvFile = argv[++i];
    else if (token === '--wp-post-id') args.wpPostId = argv[++i];
    else if (token === '--keep') args.keep = true;
    else throw new Error(`Unexpected argument: ${token}`);
  }
  if (!args.wpEnvFile || !args.wixEnvFile || !args.wpPostId) {
    throw new Error(`Missing required argument(s).\n\n${usage()}`);
  }
  return args;
}

// Same mapping as documented in item-seo-tags.json's mappingGuidance and already dry-run
// tested against poratus.wpcomstaging.com: title/description/og:*/twitter:card carry over;
// canonical, robots, and schema are deliberately dropped (source-domain / source-artefact /
// source-shaped, never passed through verbatim — see wordpress-seo.json's pitfalls).
function mapYoastHeadToItemSeoTags(head, focusKeyword) {
  const tags = [];
  if (head.title) tags.push({ type: 'title', children: head.title });
  if (head.description) tags.push({ type: 'meta', props: { name: 'description', content: head.description } });
  for (const [key, prop] of [
    ['og_title', 'og:title'],
    ['og_description', 'og:description'],
    ['og_type', 'og:type'],
    ['og_url', 'og:url'],
  ]) {
    if (head[key]) tags.push({ type: 'meta', props: { property: prop, content: head[key] } });
  }
  if (Array.isArray(head.og_image) && head.og_image[0]?.url) {
    tags.push({ type: 'meta', props: { property: 'og:image', content: head.og_image[0].url } });
  }
  if (head.twitter_card) tags.push({ type: 'meta', props: { name: 'twitter:card', content: head.twitter_card } });
  const focusKeywords = focusKeyword ? [{ term: focusKeyword, isMain: true }] : [];
  return { tags, focusKeywords };
}

async function fetchWpPost(wpBaseUrl, wpUser, wpAppPassword, postId) {
  const auth = 'Basic ' + Buffer.from(`${wpUser}:${wpAppPassword.replace(/\s+/g, '')}`).toString('base64');
  const res = await fetch(`${wpBaseUrl.replace(/\/$/, '')}/wp-json/wp/v2/posts/${postId}?context=edit`, {
    headers: { Authorization: auth },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WordPress read of post ${postId} failed: ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function minimalRicosDocument(text) {
  return {
    nodes: [
      {
        type: 'PARAGRAPH',
        id: '',
        nodes: [{ type: 'TEXT', id: '', textData: { text, decorations: [] } }],
      },
    ],
  };
}

async function bulkSetItemSeoTags(wix, itemType, entries, { publish = false, returnEntity = true } = {}) {
  return wix.send({
    method: 'POST',
    url: `${WIXAPIS}/promote/seo/v1/bulk/item-seo-tags/set`,
    body: { itemType, entries, publish, returnEntity },
  });
}

async function getItemSeoTags(wix, itemType, itemId) {
  return wix.send({ method: 'GET', url: `${WIXAPIS}/promote/seo/v1/item-seo-tags/${itemType}/${itemId}` });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wpEnv = await readEnvFile(args.wpEnvFile);
  const wixEnv = await readEnvFile(args.wixEnvFile);

  const wpPost = await fetchWpPost(wpEnv.WP_BASE_URL, wpEnv.WP_USERNAME, wpEnv.WP_APPLICATION_PASSWORD, args.wpPostId);
  const focusKeyword = wpPost.meta?._yoast_wpseo_focuskw || null;
  if (!wpPost.meta?._yoast_wpseo_title && !wpPost.meta?._yoast_wpseo_metadesc) {
    throw new Error(
      `WordPress post ${args.wpPostId} has no genuine Yoast override (_yoast_wpseo_title/_metadesc are empty) — ` +
        're-run scripts/test-site-seed/seed-plugin-data.mjs first, or pass an already-seeded post id.',
    );
  }
  const mapped = mapYoastHeadToItemSeoTags(wpPost.yoast_head_json || {}, focusKeyword);
  const wantedTitle = mapped.tags.find((t) => t.type === 'title')?.children;

  const wix = createWixClient({ authToken: wixEnv.WIX_API_KEY, siteId: wixEnv.WIX_SITE_ID });

  let draftPostId = null;
  let outcome = { ok: false };
  try {
    const memberList = await listMembers(wix, { limit: 1 });
    const memberId = memberList?.members?.[0]?.id;
    if (!memberId) {
      throw new Error(
        'no member found on the target site to author the throwaway post — the site owner\'s ' +
          'auto-created user-member should normally be present (see wix-writers.js listMembers comment)',
      );
    }

    const draft = await createDraftPost(wix, {
      title: `[spec-0056 verification — safe to delete] ${wpPost.slug}`,
      memberId,
      richContent: minimalRicosDocument(
        'Throwaway post created by item-seo-tags-verify.js (spec 0056) to live-verify the Bulk Set Item SEO Tags write path. Safe to delete.',
      ),
    });
    draftPostId = draft.id;
    await publishDraftPost(wix, draftPostId);

    const setResult = await bulkSetItemSeoTags(
      wix,
      'BLOG_POST',
      [
        {
          itemId: draftPostId,
          itemSeoTags: { tags: mapped.tags, focusKeywords: mapped.focusKeywords },
          fieldMask: ['tags', 'focusKeywords'],
        },
      ],
      { returnEntity: true },
    );

    const entry = setResult.results?.[0];
    if (!entry?.itemMetadata?.success) {
      throw new Error(`Bulk Set Item SEO Tags failed for the entry: ${JSON.stringify(entry?.itemMetadata?.error)}`);
    }

    const readBack = await getItemSeoTags(wix, 'BLOG_POST', draftPostId);
    const resolvedTitle = (readBack.resolvedTags || []).find((rt) => rt.tag?.type === 'title');
    const titleLandedAsItemOverride = resolvedTitle?.source === 'TAG_SOURCE_ITEM' && resolvedTitle.tag?.children === wantedTitle;

    outcome = {
      ok: titleLandedAsItemOverride,
      draftPostId,
      wpPostId: args.wpPostId,
      mappedTags: mapped.tags,
      setResult,
      readBack,
    };
  } finally {
    if (draftPostId && !args.keep) {
      try {
        await deleteDraftPost(wix, draftPostId, { permanent: true });
        outcome.cleanup = 'deleted';
      } catch (cleanupError) {
        outcome.cleanup = 'FAILED';
        outcome.retainedItemId = draftPostId;
        console.error(
          `CLEANUP FAILED — throwaway Wix Blog post retained on the target site, itemId=${draftPostId}: ${cleanupError.message}`,
        );
      }
    } else if (draftPostId) {
      outcome.cleanup = 'skipped (--keep)';
      outcome.retainedItemId = draftPostId;
    }
  }

  console.log(JSON.stringify(outcome, null, 2));
  if (!outcome.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
