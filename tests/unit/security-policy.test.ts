import { describe, expect, it } from 'vitest';
import { resolveAppPath } from '../../apps/desktop/src/main/app-path';
import {
  CONTENT_SECURITY_POLICY,
  assertLocalDevOrigin,
  devContentSecurityPolicy,
  isRequestAllowed,
  isTrustedPageUrl,
  redactUrl,
} from '../../apps/desktop/src/main/security-policy';

describe('1.6 第 2 条 CSP', () => {
  it('与规格逐字一致', () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'none'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self'",
    );
  });
  it('开发模式只额外放行本机开发服务器', () => {
    const dev = devContentSecurityPolicy('http://localhost:5173/');
    expect(dev).toContain("connect-src 'self' http://localhost:5173 ws://localhost:5173");
    expect(dev).toContain("script-src 'self' blob: http://localhost:5173");
    expect(dev).toContain("default-src 'none'");
    expect(dev).not.toContain('unsafe-eval');
    expect(dev).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
  it('开发服务器必须是本机地址', () => {
    expect(() => assertLocalDevOrigin('http://example.com:5173')).toThrow();
    expect(() => assertLocalDevOrigin('https://localhost:5173')).toThrow();
    expect(assertLocalDevOrigin('http://127.0.0.1:5173/x')).toBe('http://127.0.0.1:5173');
  });
});

describe('1.6 第 3 条 会话级网络拦截', () => {
  it.each([
    ['app://renderer/index.html', true],
    ['app://other/index.html', false],
    ['blob:app://renderer/1234', true],
    ['data:image/png;base64,AAAA', true],
    ['devtools://devtools/bundled/x.html', true],
    ['https://example.com/', false],
    ['http://localhost:5173/', false],
    ['ws://localhost:5173/', false],
    ['file:///C:/Windows/win.ini', false],
    ['chrome-extension://abc/x.js', false],
    ['not a url', false],
  ])('生产：%s → %s', (url, allowed) => {
    expect(isRequestAllowed(url, null)).toBe(allowed);
  });
  it('开发：只多放行开发服务器本身', () => {
    expect(isRequestAllowed('http://localhost:5173/src/main.tsx', 'http://localhost:5173')).toBe(true);
    expect(isRequestAllowed('ws://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isRequestAllowed('http://localhost:8080/', 'http://localhost:5173')).toBe(false);
    expect(isRequestAllowed('https://example.com/', 'http://localhost:5173')).toBe(false);
  });
  it('日志不记查询参数', () => {
    expect(redactUrl('https://example.com/a/b?token=secret')).toBe('https://example.com/a/b');
    expect(redactUrl('data:text/plain,hello')).toBe('data:…');
  });
  it('可信页面', () => {
    expect(isTrustedPageUrl('app://renderer/index.html', null)).toBe(true);
    expect(isTrustedPageUrl('https://evil.example/', null)).toBe(false);
    expect(isTrustedPageUrl('http://localhost:5173/', null)).toBe(false);
    expect(isTrustedPageUrl('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
  });
});

describe('app:// 路径解析', () => {
  const root = process.platform === 'win32' ? 'C:\\app\\out\\renderer' : '/app/out/renderer';
  const inRoot = (p: string | null) => p !== null && p.replace(/\\/g, '/').startsWith(root.replace(/\\/g, '/') + '/');
  it('正常路径落在根目录里', () => {
    expect(resolveAppPath(root, 'app://renderer/index.html')).toMatch(/renderer[\\/]index\.html$/);
    expect(resolveAppPath(root, 'app://renderer/')).toMatch(/index\.html$/);
    expect(resolveAppPath(root, 'app://renderer/assets/a%20b.js')).toMatch(/assets[\\/]a b\.js$/);
  });
  it.each(['app://renderer/../package.json', 'app://renderer/%2e%2e/%2e%2e/secret'])('URL 解析会规整掉 ..，结果仍在根目录里：%s', (url) => {
    expect(inRoot(resolveAppPath(root, url))).toBe(true);
  });
  it.each([
    'app://renderer/..%2f..%2fpackage.json',
    'app://renderer/..%5c..%5csecret',
    'app://renderer/a%00.js',
    'app://other/index.html',
    'app://renderer/%E0%A4%A',
    'https://renderer/index.html',
  ])('拒绝 %s', (url) => {
    expect(resolveAppPath(root, url)).toBeNull();
  });
});
