'use strict';

const ledger = require('./blog-post-build-ledger');
const build = require('./blog-post-build');
const media = require('./blog-post-media');

// The generated importer owns source conversion and crosswalk storage. This bridge owns
// the ordering between verified build state, the normal crosswalk, and media closure.
async function runBlogBuildStage({ projectDir, sourcePosts, preparedPosts, client, crosswalk,
  pendingMedia, runId, checks = [], transforms = {}, options = {} }) {
  if (!Array.isArray(sourcePosts) || !Array.isArray(preparedPosts))
    throw new Error('blog stage needs sourcePosts and preparedPosts arrays');
  if (!crosswalk || typeof crosswalk.get !== 'function' ||
    typeof crosswalk.idOwners !== 'function' || typeof crosswalk.set !== 'function' ||
    typeof crosswalk.recordVerified !== 'function') throw new Error('blog stage needs bound crosswalk operations');
  if (!pendingMedia) throw new Error('blog stage needs pending media state');
  const byKey = new Map(sourcePosts.map(post => [media.postStableKey(post), post]));
  const preparedByKey = new Map(preparedPosts.map(post => [post.sourceStableKey, post]));
  if (byKey.size !== sourcePosts.length || preparedByKey.size !== preparedPosts.length ||
    preparedPosts.some(post => !byKey.has(post.sourceStableKey))) throw new Error('blog stage source keys differ');
  const report = await build.runBlogBuild({ projectDir, posts: preparedPosts, client,
    crosswalk, checks, transforms, options: { ...options, runId } });
  const state = ledger.fold(ledger.readRows(projectDir));
  for (const row of report.addresses.filter(item => item.phase === 'verified')) {
    if (!byKey.has(row.sourceStableKey)) continue; // a resumed batch may omit earlier verified posts
    const phase = state.posts.get(row.sourceStableKey)?.phase;
    if (!phase?.postId) throw new Error(`verified blog post ${row.sourceStableKey} lacks post id`);
    await crosswalk.recordVerified(byKey.get(row.sourceStableKey), phase.postId);
    const prepared = preparedByKey.get(row.sourceStableKey);
    if (prepared.existingCrosswalk) {
      await pendingMedia.closeIfCrosswalked(byKey.get(row.sourceStableKey).id,
        { targetPostId: phase.postId, runId });
    } else {
      await pendingMedia.markResolved(byKey.get(row.sourceStableKey).id,
        { targetPostId: phase.postId, runId, resumed: prepared.mediaResumed === true });
    }
  }
  const pending = await media.summarizePendingBlogMedia({ state: pendingMedia,
    crosswalk: key => state.posts.get(key)?.phase?.phase === 'verified' });
  // A pre-ledger crosswalk hit can have unresolved local media evidence without an
  // open pending-media row (including an already-resolved historical row). Its build
  // phase is still a pending post and must count against import completion.
  const present = new Set(pending.pending.map(row => row.sourceStableKey));
  for (const row of report.pending) {
    if (present.has(row.sourceStableKey)) continue;
    pending.pending.push({ sourceStableKey: row.sourceStableKey,
      title: byKey.get(row.sourceStableKey)?.title || null, awaitingWrite: false,
      reason: row.reason, media: row.media, existingCrosswalk: Boolean(preparedByKey.get(row.sourceStableKey)?.existingCrosswalk) });
    present.add(row.sourceStableKey);
  }
  pending.pendingMedia = pending.pending.length;
  return { report, pending };
}

module.exports = { runBlogBuildStage };
