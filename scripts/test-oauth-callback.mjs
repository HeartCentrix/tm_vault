import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});
const originalFetch = globalThis.fetch;
try {
  const { authService } = await server.ssrLoadModule('/src/services/auth.ts');
  for (const [body, expected] of [
    [JSON.stringify({ detail: 'Microsoft sign-in is unavailable. Please contact your administrator.' }), 'Microsoft sign-in is unavailable. Please contact your administrator.'],
    [JSON.stringify({ detail: { internal: 'do not render structured data' } }), 'OAuth callback failed: 503 Service Unavailable'],
    ['<html>gateway failure</html>', 'OAuth callback failed: 503 Service Unavailable'],
    [JSON.stringify({ detail: '' }), 'OAuth callback failed: 503 Service Unavailable'],
  ]) {
    globalThis.fetch = async () => new Response(body, { status: 503, statusText: 'Service Unavailable' });
    await assert.rejects(authService.handleOAuthCallback('test-code', 'test-state'), { message: expected });
  }

  const login = { accessToken: 'test-only-access', refreshToken: 'test-only-refresh', expiresIn: 3600,
    user: { id: 'test-user', email: 'test@example.invalid', name: 'Test', roles: ['USER'], organizationId: 'test-org' } };
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { code: 'test-code', state: 'test-state' });
    return new Response(JSON.stringify(login), { status: 200 });
  };
  assert.deepEqual(await authService.handleOAuthCallback('test-code', 'test-state'), login);
  console.log('OAuth callback: 5 cases passed');
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}
