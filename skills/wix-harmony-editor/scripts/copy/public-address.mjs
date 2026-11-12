// Which source addresses import-media.mjs may download from. Only a GLOBAL UNICAST address
// passes: this is an allowlist, not a list of known-private ranges, because a deny list misses
// whatever it forgot (multicast, broadcast, benchmarking, documentation, newer IPv6 scopes). The
// ranges are the IANA IPv4/IPv6 Special-Purpose Address Registries' entries that are not globally
// reachable, plus multicast and reserved space; IPv6 must also lie in 2000::/3.
//
// The same rules live in wix-replatform's lib/document-url-guard.js. The two skills are published
// separately and cannot import each other, so tests/target-wix/public-address-parity-test.js runs
// one vector set against both to keep them identical.
import net from 'node:net';

// Generate File Upload URL is non-resumable and Wix sends files over 10 MB to the resumable
// endpoint, so a download is capped below that.
export const MAX_UPLOAD_BYTES = 10 * 1000 * 1000;

const NON_GLOBAL = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) NON_GLOBAL.addSubnet(address, prefix, 'ipv4');
// Inside 2000::/3: IETF protocol assignments (incl. Teredo), documentation, 6to4 (it can wrap any
// IPv4 address, private ones included), and the second documentation block.
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) NON_GLOBAL.addSubnet(address, prefix, 'ipv6');

function ipv6Hextets(address) {
  let text = address;
  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const octets = dotted[2].split('.').map(Number);
    text = `${dotted[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const [head, tail] = text.includes('::') ? text.split('::') : [text, null];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail === null ? [] : new Array(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((part) => parseInt(part, 16));
}

// True only for a literal IP address that is globally routable unicast.
export function isGlobalUnicastAddress(value) {
  const address = String(value || '').toLowerCase().replace(/^\[|\]$/g, '');
  const family = net.isIP(address);
  if (family === 4) return !NON_GLOBAL.check(address, 'ipv4');
  if (family !== 6) return false;
  const hextets = ipv6Hextets(address);
  // An IPv4-mapped address is the IPv4 destination in another notation: judge that address.
  if (hextets.slice(0, 5).every((part) => part === 0) && hextets[5] === 0xffff) {
    return isGlobalUnicastAddress([hextets[6] >> 8, hextets[6] & 0xff, hextets[7] >> 8, hextets[7] & 0xff].join('.'));
  }
  if ((hextets[0] & 0xe000) !== 0x2000) return false;
  return !NON_GLOBAL.check(address, 'ipv6');
}

// Lexical check on a URL hostname: an IP literal must be global unicast; a name is refused only
// when it is local by definition, and is otherwise judged by the addresses it resolves to.
export function isPrivateHostname(hostname) {
  // A trailing dot is the same name (`localhost.` resolves like `localhost`) and WHATWG URL keeps it on a name host.
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!host) return true;
  if (net.isIP(host)) return !isGlobalUnicastAddress(host);
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local');
}
