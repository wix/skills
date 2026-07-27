// OAuth2 client-credentials token provider for the Wix public API.
//
// The EvalForge V1 API (www.wixapis.com) is called with a Bearer token minted
// from the app's OAuth credentials. Tokens are short-lived (~300s), but an eval
// run can poll for up to 30 minutes — so we cache the token and transparently
// re-mint it shortly before it expires rather than minting once up front.

import * as core from '@actions/core';

type TokenResponse = { access_token: string; token_type: string; expires_in: number };

// Re-mint this many ms before the stated expiry to avoid using a token that
// expires mid-request.
const EXPIRY_SKEW_MS = 30_000;

export class TokenProvider {
  private token: string | null = null;
  private expiresAt = 0; // epoch ms
  // In-flight mint shared by concurrent callers, so a burst of parallel requests
  // (e.g. the gate's per-name scenario queries) mints once, not once each.
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly tokenUrl: string,   // e.g. https://www.wixapis.com/oauth2/token
    private readonly clientId: string,    // Wix app def id
    private readonly clientSecret: string, // Wix app secret
  ) {}

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - EXPIRY_SKEW_MS) {
      return this.token;
    }
    if (!this.inflight) {
      this.inflight = this.mint().finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }

  /**
   * Mints a fresh token to recover from a `401` on a token rejected before its
   * computed expiry (e.g. server-side revocation). Pass the rejected token as
   * `staleToken`: if a concurrent caller already refreshed past it, the fresh token
   * is returned without minting again, and concurrent refreshes of the same stale
   * token fold into a single in-flight mint — avoiding a token-churn loop when a
   * burst of parallel requests all `401` at once.
   */
  async forceRefresh(staleToken?: string): Promise<string> {
    if (staleToken && this.token && this.token !== staleToken) {
      return this.token;
    }
    if (!this.inflight) {
      this.token = null;
      this.expiresAt = 0;
      this.inflight = this.mint().finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }

  private async mint(): Promise<string> {
    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OAuth token request → ${res.status}: ${text.replace(/\s+/g, ' ').trim().slice(0, 300)}`);
    }
    const json = (await res.json()) as TokenResponse;
    if (!json.access_token) {
      throw new Error('OAuth token response missing access_token');
    }
    // Mask the minted token so it can never surface in action logs.
    core.setSecret(json.access_token);
    this.token = json.access_token;
    this.expiresAt = Date.now() + (json.expires_in ?? 300) * 1000;
    return this.token;
  }
}
