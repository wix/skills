export function isUrlShaped(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function normalizeUrl(s: string): string {
  const u = new URL(s);
  const scheme = u.protocol.toLowerCase();
  const host = u.host.toLowerCase();
  const path = u.pathname.replace(/\/+$/, '');
  return `${scheme}//${host}${path}`;
}
