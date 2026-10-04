import { describe, expect, it } from 'vitest';
import {
  CODEX_REDIRECT_URI,
  buildAuthorizeUrl,
  extractCallbackCode,
  pkceChallengeFromVerifier,
  randomCodeVerifier,
} from '@/lib/oauth';

describe('PKCE', () => {
  it('randomCodeVerifier 生成 43 字符的 base64url', () => {
    const v = randomCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomCodeVerifier()).not.toBe(v);
  });
  it('S256 challenge 与 RFC 7636 附录测试向量一致', async () => {
    const challenge = await pkceChallengeFromVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('buildAuthorizeUrl', () => {
  it('包含 codex login 的关键参数', () => {
    const url = new URL(buildAuthorizeUrl('challenge123', 'state456'));
    expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize');
    const p = url.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
    expect(p.get('redirect_uri')).toBe(CODEX_REDIRECT_URI);
    expect(p.get('code_challenge')).toBe('challenge123');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('state')).toBe('state456');
    expect(p.get('scope')).toContain('openid');
    expect(p.get('originator')).toBe('codex_cli_rs');
    expect(p.get('codex_cli_simplified_flow')).toBe('true');
  });
});

describe('extractCallbackCode', () => {
  it('匹配的 state 提取 code', () => {
    expect(
      extractCallbackCode(`${CODEX_REDIRECT_URI}?code=abc&state=xyz`, 'xyz'),
    ).toBe('abc');
  });
  it('state 不匹配 / 非回调 URL / 缺 code 返回 null', () => {
    expect(extractCallbackCode(`${CODEX_REDIRECT_URI}?code=abc&state=other`, 'xyz')).toBeNull();
    expect(extractCallbackCode('https://example.com/auth/callback?code=abc&state=xyz', 'xyz')).toBeNull();
    expect(extractCallbackCode(`${CODEX_REDIRECT_URI}?state=xyz`, 'xyz')).toBeNull();
  });
});
