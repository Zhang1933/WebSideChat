/**
 * ChatGPT OAuth 网页登录（复刻 codex login 的 PKCE 流程）：
 * 打开 auth.openai.com 授权页 → 用户登录后浏览器跳转 127.0.0.1:1455/auth/callback
 * （扩展无法监听端口，轮询标签页 URL 捕获 code）→ 用 code + verifier 换 token。
 * 扩展全程接触不到账号密码，只拿到令牌。
 */

export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_REDIRECT_URI = 'http://127.0.0.1:1455/auth/callback';

const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const SCOPES =
  'openid profile email offline_access api.connectors.read api.connectors.invoke';

export interface CodexLoginResult {
  access_token: string;
  refresh_token?: string;
  account_id?: string;
  id_token?: string;
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** PKCE code_verifier：32 随机字节的 base64url（43 字符，符合 RFC 7636 长度要求） */
export function randomCodeVerifier(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** PKCE S256：code_challenge = base64url(SHA-256(verifier)) */
export async function pkceChallengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

/** 组装授权页 URL（参数与 codex login 一致，redirect_uri 必须在其白名单内） */
export function buildAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CODEX_CLIENT_ID,
    redirect_uri: CODEX_REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: SCOPES,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** 校验回调 URL 并提取 code（state 不匹配返回 null，防串扰） */
export function extractCallbackCode(url: string, state: string): string | null {
  if (!url.startsWith(CODEX_REDIRECT_URI)) return null;
  try {
    const u = new URL(url);
    if (u.searchParams.get('state') !== state) return null;
    return u.searchParams.get('code');
  } catch {
    return null;
  }
}

/**
 * 完整登录流程（在扩展页面上下文调用）：
 * 新标签页打开授权页 → 轮询该标签页 URL（含 pendingUrl，连接失败的错误页 URL 仍可读）
 * → 捕获 code 后关闭标签页 → 换取令牌。
 */
export async function loginCodexOAuth(): Promise<CodexLoginResult> {
  const verifier = randomCodeVerifier();
  const challenge = await pkceChallengeFromVerifier(verifier);
  const state = randomCodeVerifier();

  const tab = await browser.tabs.create({ url: buildAuthorizeUrl(challenge, state), active: true });
  if (tab.id == null) throw new Error('无法打开登录页');

  const code = await new Promise<string>((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      void (async () => {
        let current: { url?: string; pendingUrl?: string } | null = null;
        try {
          current = await browser.tabs.get(tab.id!);
        } catch {
          cleanup();
          reject(new Error('登录窗口已被关闭'));
          return;
        }
        for (const url of [current?.url, current?.pendingUrl]) {
          if (!url) continue;
          const extracted = extractCallbackCode(url, state);
          if (extracted) {
            cleanup();
            void browser.tabs.remove(tab.id!).catch(() => {});
            resolve(extracted);
            return;
          }
        }
        if (Date.now() - startedAt > 5 * 60_000) {
          cleanup();
          void browser.tabs.remove(tab.id!).catch(() => {});
          reject(new Error('登录超时（5 分钟未完成）'));
        }
      })();
    }, 800);
    function cleanup() {
      clearInterval(timer);
    }
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CODEX_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: CODEX_REDIRECT_URI,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`令牌换取失败（HTTP ${res.status}）${text ? `：${text.slice(0, 200)}` : ''}`);
  }
  const json = (await res.json()) as CodexLoginResult;
  if (!json.access_token) throw new Error('令牌响应缺少 access_token');
  return json;
}
