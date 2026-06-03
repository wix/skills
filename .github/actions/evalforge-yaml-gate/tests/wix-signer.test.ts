import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { signWixToken } from '../src/utils/wix-signer';

function b64urlDecode(s: string): string {
  // Pad back to multiple of 4
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

describe('signWixToken', () => {
  const APP_ID = '0f8109a3-bb90-4904-894f-8d3d0f3d1c4d';
  const APP_SECRET = 'test-secret-do-not-use';

  it('produces a SRV.JWS.<header>.<payload>.<signature> shape', () => {
    const token = signWixToken(APP_ID, APP_SECRET);
    const parts = token.split('.');
    // Expected: ['SRV', 'JWS', headerB64, payloadB64, signatureB64]
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('SRV');
    expect(parts[1]).toBe('JWS');
  });

  it('header is HS256+JWT', () => {
    const token = signWixToken(APP_ID, APP_SECRET);
    const [, , headerB64] = token.split('.');
    const header = JSON.parse(b64urlDecode(headerB64));
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('payload has iat, exp, and data as a JSON-encoded string containing appDefId', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signWixToken(APP_ID, APP_SECRET, 900);
    const after = Math.floor(Date.now() / 1000);
    const [, , , payloadB64] = token.split('.');
    const payload = JSON.parse(b64urlDecode(payloadB64));

    expect(typeof payload.iat).toBe('number');
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.iat).toBeLessThanOrEqual(after);
    expect(payload.exp).toBe(payload.iat + 900);

    // data is a JSON-encoded STRING, not a nested object — this is the wire format the edge expects
    expect(typeof payload.data).toBe('string');
    expect(JSON.parse(payload.data)).toEqual({ appDefId: APP_ID });
  });

  it('signature is HMAC-SHA256 over headerB64.payloadB64 using the app secret', () => {
    const token = signWixToken(APP_ID, APP_SECRET);
    const [, , headerB64, payloadB64, sigB64] = token.split('.');
    const signingInput = `${headerB64}.${payloadB64}`;
    const expectedSig = createHmac('sha256', APP_SECRET)
      .update(signingInput)
      .digest('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(sigB64).toBe(expectedSig);
  });

  it('respects custom expiry', () => {
    const token = signWixToken(APP_ID, APP_SECRET, 60);
    const [, , , payloadB64] = token.split('.');
    const payload = JSON.parse(b64urlDecode(payloadB64));
    expect(payload.exp - payload.iat).toBe(60);
  });
});
