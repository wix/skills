import { createHmac } from 'node:crypto';

const PREFIX = 'SRV.JWS';
const DEFAULT_EXPIRY_SECONDS = 900;

export function signWixToken(
  appDefId: string,
  appSecret: string,
  expiryInSeconds: number = DEFAULT_EXPIRY_SECONDS,
): string {
  const iat = Math.floor(Date.now() / 1000);
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify({
    iat,
    data: JSON.stringify({ appDefId }),
    exp: iat + expiryInSeconds,
  })).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = createHmac('sha256', appSecret).update(signingInput).digest('base64url');
  return `${PREFIX}.${signingInput}.${signature}`;
}
