'use strict';

const WRITER_ROOT = '/_api/url-mapper/writer/v1/url-mapping';

function createUrlMapperTransport({ send, inspectDestination }) {
  if (typeof send !== 'function' || typeof inspectDestination !== 'function') throw new Error('authenticated sender and destination inspection required');
  return {
    inspectDestination,
    async read(key) {
      const result = await send({ method: 'GET', path: `${WRITER_ROOT}/${encodeURIComponent(key)}` });
      if (result && (result.code === 'URL_MAPPER_NOT_FOUND' || result.status === 404)) return null;
      const mapping = result && (result.urlMapping || result.mappingRecord || result);
      if (!mapping || typeof mapping.mapping !== 'string' || typeof mapping.pageIdentifier !== 'string') {
        throw new Error(`URL Mapper read-back for ${key} lacks saved mapping or page identifier`);
      }
      return mapping;
    },
    async write(payload, capability, { mode }) {
      if (!capability || payload.key !== capability.key || payload.urlMapping?.pageIdentifier !== capability.pageIdentifier) {
        throw new Error('URL Mapper payload differs from capability knowledge');
      }
      if (!['create', 'update'].includes(mode)) throw new Error('URL Mapper write mode required');
      return send({ method: mode === 'create' ? 'POST' : 'PUT', path: `${WRITER_ROOT}/${encodeURIComponent(payload.key)}`, body: payload });
    },
  };
}

module.exports = { WRITER_ROOT, createUrlMapperTransport };
