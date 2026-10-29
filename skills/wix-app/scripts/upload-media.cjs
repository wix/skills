#!/usr/bin/env node
'use strict';

// oxlint-disable no-console

/**
 * Uploads images to the site's Media Manager so they can be `Image` defaults, cropping
 * them first when a photo sits inside a larger screenshot or design.
 *
 *   node <SKILL_ROOT>/scripts/upload-media.cjs --size <image>
 *   node <SKILL_ROOT>/scripts/upload-media.cjs [--crop <left,top,width,height>] <file|url> ...
 *
 * Run from the app root. Each argument is a local file or an http(s) image URL; URLs are
 * downloaded first, over https only (http is upgraded), on the default port, and only
 * from public addresses: every hop, redirects included, is resolved and refused when it
 * points at a private, loopback or link-local address. `--size` prints each image's width and height. `--crop` applies to the
 * image after it; each value is pixels (`156`) or a percentage of the image (`12%`), so
 * repeat `--crop <area> <screenshot>` once per photo. Cropping uses `sharp`, installed
 * under /tmp/user-images when the app doesn't have it, so the project is never touched.
 *
 * Uploads authenticate with the logged-in Wix CLI (`wix token --json`): Generate File
 * Upload URL, then a PUT of the bytes. One JSON report is printed; each `uploads[].image`
 * is the `{ uri, url }` to put in `defaultProps` (add `alt` yourself).
 *
 * Exit codes: 0 every file uploaded (or sized), 1 at least one failed, 2 the script could
 * not run (bad arguments, or no CLI token).
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const { lookup } = require('dns').promises;
const { createRequire } = require('module');
const { execFileSync } = require('child_process');

const GENERATE_UPLOAD_URL = 'https://www.wixapis.com/site-media/v1/files/generate-upload-url';
const TOKEN_TIMEOUT_MS = 30_000;
const SHARP_INSTALL_TIMEOUT_MS = 180_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const WORK_DIR = '/tmp/user-images';
const USAGE = `Usage: node <SKILL_ROOT>/scripts/upload-media.cjs --size <image>
       node <SKILL_ROOT>/scripts/upload-media.cjs [--crop <left,top,width,height>] <file|url> ...`;
const MIME_TYPES = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const CROP_VALUE = /^(\d+(?:\.\d+)?)(%?)$/;

function mimeTypeOf(file) {
  return MIME_TYPES[path.extname(file).toLowerCase()];
}

function isUrl(source) {
  return /^https?:\/\//i.test(source);
}

function extensionForMime(mimeType) {
  const match = Object.entries(MIME_TYPES).find(([, type]) => type === mimeType);
  return match?.[0];
}

/** False for addresses the sandbox must not fetch: private, loopback, link-local, CGNAT, multicast, reserved. */
function isPublicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const groups = ipv6Groups(address);
  if (groups.length !== 8 || groups.some((group) => !(group >= 0 && group <= 0xffff))) return false;
  const tail = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  const zeros = (count) => groups.slice(0, count).every((group) => group === 0);
  // IPv4-mapped (::ffff:a.b.c.d, also written ::ffff:7f00:1), IPv4-compatible (::a.b.c.d)
  // and NAT64 (64:ff9b::a.b.c.d) addresses carry an IPv4 address: check that one.
  if (zeros(5) && groups[5] === 0xffff) return isPublicAddress(tail);
  if (zeros(6)) return groups[6] === 0 && groups[7] <= 1 ? false : isPublicAddress(tail);
  if (
    groups[0] === 0x64 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((group) => group === 0)
  )
    return isPublicAddress(tail);
  return !(
    (groups[0] & 0xfe00) === 0xfc00 ||
    (groups[0] & 0xffc0) === 0xfe80 ||
    (groups[0] & 0xff00) === 0xff00 ||
    (groups[0] === 0x2001 && groups[1] === 0x0db8)
  );
}

/** The eight 16-bit groups of an IPv6 address, with `::` expanded and a dotted IPv4 tail split in two. */
function ipv6Groups(address) {
  let text = address
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .split('%')[0];
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const left = head ? head.split(':') : [];
  if (tail === undefined) return left.map((group) => parseInt(group, 16));
  const right = tail ? tail.split(':') : [];
  const fill = Array(Math.max(0, 8 - left.length - right.length)).fill('0');
  return [...left, ...fill, ...right].map((group) => parseInt(group, 16));
}

/** Returns the https URL to fetch, or throws when it may reach a non-public host. */
async function checkedUrl(url, lookupImpl) {
  const parsed = new URL(url);
  if (parsed.protocol === 'http:') parsed.protocol = 'https:';
  if (parsed.protocol !== 'https:') throw new Error(`Only https image URLs are downloaded`);
  if (parsed.username || parsed.password)
    throw new Error('Image URLs with credentials are refused');
  if (parsed.port && parsed.port !== '443')
    throw new Error('Image URLs on a non-default port are refused');
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await lookupImpl(host, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error(`Refusing to download from ${parsed.hostname}: it is not a public address`);
  }
  return parsed.href;
}

async function downloadToFile(url, index, fetchImpl = fetch, lookupImpl = lookup) {
  // Redirects are followed by hand so each hop is checked before it is fetched.
  let current = url;
  let response;
  for (let hop = 0; ; hop += 1) {
    current = await checkedUrl(current, lookupImpl);
    response = await fetchImpl(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    const location =
      response.status >= 300 && response.status < 400 && response.headers.get('location');
    if (!location) break;
    if (hop === MAX_REDIRECTS)
      throw new Error(`Download redirected more than ${MAX_REDIRECTS} times`);
    current = new URL(location, current).href;
  }
  if (!response.ok) throw new Error(`Download failed, HTTP ${response.status}`);
  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim();
  const extension =
    extensionForMime(contentType) ?? path.extname(new URL(url).pathname).toLowerCase();
  if (!MIME_TYPES[extension]) {
    throw new Error(`Download is not a supported image (${contentType || 'unknown type'})`);
  }
  if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
    throw new Error('Download is larger than 25 MB');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('Download is larger than 25 MB');
  const name = path
    .basename(new URL(url).pathname, path.extname(new URL(url).pathname))
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '');
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const output = path.join(WORK_DIR, `${name || 'image'}-${index}${extension}`);
  fs.writeFileSync(output, bytes);
  return output;
}

function localSource(file, index, fetchImpl, lookupImpl) {
  return isUrl(file) ? downloadToFile(file, index, fetchImpl, lookupImpl) : file;
}

function parseCrop(spec) {
  const parts = String(spec)
    .split(',')
    .map((part) => part.trim());
  const values = parts.map((part) => CROP_VALUE.exec(part));
  if (parts.length !== 4 || values.some((value) => !value)) {
    throw new Error(`Invalid --crop "${spec}"; use left,top,width,height in pixels or %`);
  }
  const [left, top, width, height] = values.map(([, amount, percent]) => ({
    amount: Number(amount),
    percent: percent === '%',
  }));
  return { left, top, width, height };
}

function parseArgs(argv) {
  if (argv[0] === '--size') {
    if (argv.length < 2) throw new Error('--size needs at least one image');
    return { mode: 'size', files: argv.slice(1) };
  }
  const entries = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--crop') {
      const [spec, file] = [argv[i + 1], argv[i + 2]];
      if (spec === undefined || file === undefined) {
        throw new Error('--crop needs an area and a file: --crop <left,top,width,height> <file>');
      }
      entries.push({ file, crop: parseCrop(spec) });
      i += 2;
    } else {
      entries.push({ file: argv[i] });
    }
  }
  if (entries.length === 0) throw new Error('No files specified.');
  return { mode: 'upload', entries };
}

function resolveCrop(crop, { width, height }) {
  const toPixels = ({ amount, percent }, total) =>
    Math.round(percent ? (amount / 100) * total : amount);
  const area = {
    left: toPixels(crop.left, width),
    top: toPixels(crop.top, height),
    width: toPixels(crop.width, width),
    height: toPixels(crop.height, height),
  };
  if (
    area.width < 1 ||
    area.height < 1 ||
    area.left + area.width > width ||
    area.top + area.height > height
  ) {
    throw new Error(
      `Crop ${area.left},${area.top},${area.width},${area.height} falls outside the ${width}x${height} image`,
    );
  }
  return area;
}

function requireSharpFrom(directory) {
  return createRequire(path.join(directory, 'noop.js'))('sharp');
}

function loadSharp() {
  for (const directory of [process.cwd(), WORK_DIR]) {
    try {
      return requireSharpFrom(directory);
    } catch {
      // Not installed there.
    }
  }
  fs.mkdirSync(WORK_DIR, { recursive: true });
  execFileSync(
    'npm',
    [
      'install',
      '--prefix',
      WORK_DIR,
      '--no-save',
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
      'sharp',
    ],
    { stdio: 'ignore', timeout: SHARP_INSTALL_TIMEOUT_MS },
  );
  return requireSharpFrom(WORK_DIR);
}

function lazySharp(load = loadSharp) {
  let sharp;
  return () => {
    sharp ??= load();
    return sharp;
  };
}

async function cropToFile(file, crop, index, getSharp) {
  const sharp = getSharp();
  const area = resolveCrop(crop, await sharp(file).metadata());
  const name = path
    .parse(file)
    .name.replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '');
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const output = path.join(WORK_DIR, `${name || 'image'}-crop-${index}.webp`);
  await sharp(file).extract(area).webp({ quality: 90 }).toFile(output);
  return output;
}

function getCliToken() {
  const attempts = [
    ['wix', ['token', '--json']],
    ['npx', ['wix', 'token', '--json']],
  ];
  for (const [command, args] of attempts) {
    try {
      const output = execFileSync(command, args, { encoding: 'utf8', timeout: TOKEN_TIMEOUT_MS });
      const { accessToken } = JSON.parse(output);
      if (accessToken) return accessToken;
    } catch {
      // Try the next way of running the CLI.
    }
  }
  throw new Error('Could not get a token from `wix token --json`; is the Wix CLI logged in?');
}

async function readError(response) {
  const body = await response.text();
  return `HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`;
}

async function uploadFile(file, { token, fetchImpl = fetch }) {
  const mimeType = mimeTypeOf(file);
  if (!mimeType) {
    throw new Error(`Unsupported file type; use one of ${Object.keys(MIME_TYPES).join(', ')}`);
  }
  const fileName = path.basename(file);
  const bytes = fs.readFileSync(file);

  const generated = await fetchImpl(GENERATE_UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mimeType, fileName }),
  });
  if (!generated.ok)
    throw new Error(`Generate File Upload URL failed, ${await readError(generated)}`);
  const { uploadUrl } = await generated.json();

  const uploaded = await fetchImpl(`${uploadUrl}?filename=${encodeURIComponent(fileName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: bytes,
  });
  if (!uploaded.ok) throw new Error(`Upload failed, ${await readError(uploaded)}`);
  const { file: descriptor } = await uploaded.json();
  if (!descriptor?.id || !descriptor?.url) throw new Error('Upload response has no file id or url');

  return { uri: descriptor.id, url: descriptor.url };
}

async function uploadAll(entries, { token, fetchImpl, lookupImpl, getSharp = lazySharp() }) {
  const uploads = [];
  for (const [index, { file, crop }] of entries.entries()) {
    const result = { file, ...(crop ? { crop: formatCrop(crop) } : {}) };
    try {
      const local = await localSource(file, index + 1, fetchImpl, lookupImpl);
      const source = crop ? await cropToFile(local, crop, index + 1, getSharp) : local;
      uploads.push({
        ...result,
        status: 'uploaded',
        image: await uploadFile(source, { token, fetchImpl }),
      });
    } catch (error) {
      uploads.push({ ...result, status: 'failed', error: error.message });
    }
  }
  const failed = uploads.filter((upload) => upload.status === 'failed').length;
  return {
    summary: { uploaded: uploads.length - failed, failed },
    uploads,
    exitCode: failed ? 1 : 0,
  };
}

async function readSizes(files, { getSharp = lazySharp(), fetchImpl, lookupImpl } = {}) {
  const sizes = [];
  for (const [index, file] of files.entries()) {
    try {
      const local = await localSource(file, index + 1, fetchImpl, lookupImpl);
      const { width, height } = await getSharp()(local).metadata();
      sizes.push({ file, width, height });
    } catch (error) {
      sizes.push({ file, error: error.message });
    }
  }
  return { sizes, exitCode: sizes.some((size) => size.error) ? 1 : 0 };
}

function formatCrop({ left, top, width, height }) {
  return [left, top, width, height]
    .map(({ amount, percent }) => `${amount}${percent ? '%' : ''}`)
    .join(',');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(2);
  }
  if (options.mode === 'size') {
    const { exitCode, ...report } = await readSizes(options.files);
    console.log(JSON.stringify(report));
    process.exit(exitCode);
  }
  let token;
  try {
    token = getCliToken();
  } catch (error) {
    console.log(
      JSON.stringify({
        summary: { uploaded: 0, failed: options.entries.length },
        error: error.message,
      }),
    );
    process.exit(2);
  }
  const { exitCode, ...report } = await uploadAll(options.entries, { token });
  console.log(JSON.stringify(report));
  process.exit(exitCode);
}

module.exports = {
  uploadFile,
  uploadAll,
  readSizes,
  downloadToFile,
  isPublicAddress,
  mimeTypeOf,
  parseArgs,
  parseCrop,
  resolveCrop,
};

if (require.main === module) main();
