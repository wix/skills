'use strict';

const { decodeHtmlEntities } = require('./link-census.js');

function escapeAttribute(value, quote) {
  return value.replace(/&/g, '&amp;').replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&#39;');
}

function patchHtmlHref(html, occurrence, destination) {
  if (typeof html !== 'string' || !/^char:\d+$/.test(occurrence.location || '')) throw new Error('HTML link location required');
  const start = Number(occurrence.location.slice(5));
  const fragment = html.slice(start);
  const match = /^(href|action)\s*=\s*(["'])(.*?)\2/is.exec(fragment);
  if (!match || decodeHtmlEntities(match[3]) !== occurrence.original) throw new Error('HTML link location or original value changed');
  const replacement = `${match[1]}=${match[2]}${escapeAttribute(destination, match[2])}${match[2]}`;
  return { value: `${html.slice(0, start)}${replacement}${html.slice(start + match[0].length)}`, preservedUnrelated: true, changedLocations: [occurrence.location] };
}

function jsonPathParts(location) {
  if (!location || !location.startsWith('$.')) throw new Error('JSON field location required');
  const parts = [];
  for (const match of location.slice(2).matchAll(/(?:^|\.)([^.\[\]]+)|\[(\d+)\]/g)) parts.push(match[1] === undefined ? Number(match[2]) : match[1]);
  if (!parts.length) throw new Error('unsupported JSON field location');
  return parts;
}

function patchJsonLink(value, occurrence, destination) {
  const clone = structuredClone(value);
  const parts = jsonPathParts(occurrence.location);
  let parent = clone;
  for (const part of parts.slice(0, -1)) {
    parent = parent && parent[part];
    if (parent === undefined) throw new Error('JSON link location missing');
  }
  const key = parts.at(-1);
  if (!parent || parent[key] !== occurrence.original) throw new Error('JSON link original value changed');
  parent[key] = destination;
  return { value: clone, preservedUnrelated: true, changedLocations: [occurrence.location] };
}

function structuredLinkPatch(baseValue, occurrence, destination) {
  if (occurrence.location && occurrence.location.startsWith('char:')) return patchHtmlHref(baseValue, occurrence, destination);
  const embedded = /^(\$\..+):(char:\d+)$/.exec(occurrence.location || '');
  if (embedded) {
    if (typeof baseValue === 'string') return patchHtmlHref(baseValue, { ...occurrence, location: embedded[2] }, destination);
    const clone = structuredClone(baseValue);
    const parts = jsonPathParts(embedded[1]);
    let parent = clone;
    for (const part of parts.slice(0, -1)) parent = parent && parent[part];
    if (!parent || typeof parent[parts.at(-1)] !== 'string') throw new Error('embedded HTML field missing');
    const patched = patchHtmlHref(parent[parts.at(-1)], { ...occurrence, location: embedded[2] }, destination);
    parent[parts.at(-1)] = patched.value;
    return { value: clone, preservedUnrelated: true, changedLocations: [occurrence.location] };
  }
  if (occurrence.location && occurrence.location.startsWith('$.')) return patchJsonLink(baseValue, occurrence, destination);
  throw new Error('unsupported link patch location');
}

module.exports = { patchHtmlHref, patchJsonLink, structuredLinkPatch };
