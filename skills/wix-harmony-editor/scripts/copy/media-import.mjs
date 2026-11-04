// The page-image import loop behind import-media.mjs, with its network injected so it can be
// tested offline. Each distinct source URL runs at most one download -> upload -> readiness chain
// per page: components that share a URL (or a rendered fallback URL) await the same in-flight
// result, so a repeated image never becomes a second download or a duplicate Media file.

// At most IMPORT_CONCURRENCY images are in flight, so peak memory is bounded by
// IMPORT_CONCURRENCY x MAX_UPLOAD_BYTES (60 MB) and a large page does not open one connection per image.
export const IMPORT_CONCURRENCY = 6;

async function mapBounded(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

// fetchImage(url) -> { ok, bytes, contentType } | { ok: false, unsafe, reason }; wixFetch is fetch.
export async function importPageImages({ desc, ledger, saveLedger, fetchImage, wixFetch, headers, sleep, concurrency = IMPORT_CONCURRENCY }) {
  async function runImport(url) {
    const fetched = await fetchImage(url);
    if (!fetched.ok) return { error: `${fetched.unsafe ? 'unsafe-source-url' : 'source-fetch-failed'}: ${fetched.reason}` };
    if (!/^image\//.test(fetched.contentType || '')) return { error: `source-fetch-failed: not-an-image (${fetched.contentType || 'no content-type'})` };
    // Generate File Upload URL rejects a MIME type that does not match the file name's extension
    // (MISMATCH_MIME_TYPE). The URL's own extension can lie (a .jpg served as WebP) or be missing, so
    // the name's extension is derived from the type the server actually sent.
    const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg' };
    const extension = extensions[fetched.contentType];
    if (!extension) return { error: `source-fetch-failed: unsupported-image-type (${fetched.contentType})` };
    const stem = url.split('/').pop().split('?')[0].replace(/\.[A-Za-z0-9]+$/, '').replace(/[^\w.~-]+/g, '-').slice(0, 80) || 'image';
    const name = `${stem}${extension}`;
    const mimeType = fetched.contentType;
    // Upload the bytes we fetched; Wix is never given the source URL.
    const gen = await wixFetch('https://www.wixapis.com/site-media/v1/files/generate-upload-url', { method: 'POST', headers, body: JSON.stringify({ mimeType: fetched.contentType, fileName: name, sizeInBytes: String(fetched.bytes.length), externalInfo: { origin: 'site-copy' } }) });
    const g0 = await gen.json().catch(() => ({}));
    let file;
    if (gen.ok && g0.uploadUrl) {
      const target = new URL(g0.uploadUrl); target.searchParams.set('filename', name);
      const put = await wixFetch(target, { method: 'PUT', headers: { 'Content-Type': fetched.contentType }, body: fetched.bytes });
      const pj = await put.json().catch(() => ({}));
      if (!put.ok || !pj.file) return { error: `upload-failed: ${put.status}`, body: JSON.stringify(pj).slice(0, 200) };
      file = pj.file;
    } else {
      return { error: `upload-url-refused: ${gen.status}`, body: JSON.stringify(g0).slice(0, 200) };
    }
    const e = { id: file.id, uri: file.id, name };
    let ready = false;
    for (let i = 0; i < 20; i++) {
      const g = await wixFetch(`https://www.wixapis.com/site-media/v1/files/${encodeURIComponent(e.id)}`, { headers }).then((x) => x.json()).catch(() => ({}));
      if (g.file?.operationStatus === 'READY') { ready = true; e.width = g.file.media?.image?.image?.width; e.height = g.file.media?.image?.image?.height; break; }
      await sleep(1500);
    }
    if (!ready) return { error: 'import not READY after 30 s', id: e.id };
    ledger[url] = e; saveLedger(ledger);
    return e;
  }

  const inFlight = new Map();
  function importOne(url) {
    if (ledger[url]?.uri) return Promise.resolve(ledger[url]);
    if (!inFlight.has(url)) inFlight.set(url, runImport(url));
    return inFlight.get(url);
  }

  const jobs = desc.components.filter((c) => c.kind === 'image' && !c.image.uri && c.image.source);
  return mapBounded(jobs, concurrency, async (c) => {
    let e = await importOne(c.image.source);
    const want = c.desktop.width / c.desktop.height;
    if (!e.uri || !e.width || Math.abs(e.width / e.height - want) / want > 0.01) { // cropped thumbnail on the source: use what it rendered
      if (c.image.sourceRendered && c.image.sourceRendered !== c.image.source) e = await importOne(c.image.sourceRendered);
    }
    if (e.uri) Object.assign(c.image, { uri: e.uri, width: e.width, height: e.height, name: e.name });
    return { key: c.key, uri: e.uri || null, size: e.width ? `${e.width}x${e.height}` : null, error: e.error || null };
  });
}
