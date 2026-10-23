'use strict';

const WIXAPIS = 'https://www.wixapis.com';
const writers = require('./wix-writers');

function unwrap(response, field) {
  const value = response?.[field];
  if (!value) throw new Error(`Wix Blog response lacks ${field}`);
  return value;
}
function readUrl(surface, id) {
  const encoded = encodeURIComponent(id);
  return `${WIXAPIS}/blog/v3/${surface}/${encoded}?fieldsets=RICH_CONTENT&fieldsets=URL`;
}
function createBlogBuildClient(wix, { fetchPage, fetchImage } = {}) {
  if (!wix || typeof wix.send !== 'function') throw new Error('blog build client needs wix.send');
  return {
    async createDraft(post) {
      const response = await wix.send({ method: 'POST', url: `${WIXAPIS}/blog/v3/draft-posts`,
        body: { draftPost: post, fieldsets: ['RICH_CONTENT', 'URL'] } });
      return unwrap(response, 'draftPost');
    },
    async updateDraft(id, projection) {
      const response = await wix.send({ method: 'PATCH', url: `${WIXAPIS}/blog/v3/draft-posts/${encodeURIComponent(id)}`,
        body: { action: 'UPDATE', draftPost: { id, ...projection }, fieldsets: ['RICH_CONTENT', 'URL'] } });
      return unwrap(response, 'draftPost');
    },
    async publishDraft(id) { return writers.publishDraftPost(wix, id); },
    async getDraft(id) { return unwrap(await wix.send({ method: 'GET', url: readUrl('draft-posts', id) }), 'draftPost'); },
    async getPost(id) { return unwrap(await wix.send({ method: 'GET', url: readUrl('posts', id) }), 'post'); },
    async listDrafts({ cursor } = {}) {
      const params = new URLSearchParams({ 'paging.limit': '100', status: 'UNPUBLISHED' });
      if (cursor?.startsWith('offset:')) params.set('paging.offset', cursor.slice('offset:'.length));
      else if (cursor) params.set('paging.cursor', cursor);
      const response = await wix.send({ method: 'GET', url: `${WIXAPIS}/blog/v3/draft-posts?${params}` });
      const drafts = response?.draftPosts;
      if (!Array.isArray(drafts)) throw new Error('Wix Blog list response lacks draftPosts');
      // Blog List Draft Posts exposes metaData; other Wix list APIs use pagingMetadata.
      // Accept either documented envelope, but never silently truncate an uncertain page.
      const metadata = response?.metaData || response?.pagingMetadata;
      if (!metadata) throw new Error('Wix Blog list response lacks pagination metadata');
      let nextCursor = metadata.cursors?.next || metadata.nextCursor || null;
      if (!nextCursor && Number.isFinite(metadata.total) && Number.isFinite(metadata.offset) &&
        metadata.offset + drafts.length < metadata.total) {
        if (!drafts.length) throw new Error('Wix Blog list made no offset progress');
        nextCursor = `offset:${metadata.offset + drafts.length}`;
      }
      if (!nextCursor && drafts.length === 100 && !Number.isFinite(metadata.total)) {
        throw new Error('Wix Blog list ended on a full page without pagination evidence');
      }
      return { drafts, nextCursor };
    },
    async deletePost(id) { return writers.deletePost(wix, id); },
    async deleteDraft(id) { return wix.send(writers.buildDeleteDraftPostRequest(id)); },
    ...(fetchPage ? { fetchPage } : {}),
    ...(fetchImage ? { fetchImage } : {}),
  };
}

module.exports = { createBlogBuildClient };
