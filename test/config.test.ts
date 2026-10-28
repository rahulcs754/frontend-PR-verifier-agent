import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildConfig, ConfigError, parseList, resolveViewport } from '../src/config.ts';

describe('buildConfig', () => {
  it('merges defaults, file and flags (flags win)', () => {
    const config = buildConfig(
      { base: 'https://a.com/', preview: 'https://old.vercel.app', routes: ['/x'], mask: ['.ad'] },
      { preview: 'https://new.vercel.app/', routes: ['pricing', '/'], viewports: ['mobile', '800x600'] },
    );
    assert.equal(config.base, 'https://a.com');
    assert.equal(config.preview, 'https://new.vercel.app');
    assert.deepEqual(config.routes, ['/pricing', '/']);
    assert.deepEqual(config.mask, ['.ad']);
    assert.deepEqual(
      config.viewports.map((v) => [v.name, v.width, v.height]),
      [
        ['mobile', 390, 844],
        ['800x600', 800, 600],
      ],
    );
    assert.equal(config.outDir, 'pr-verify-report');
  });

  it('keeps a base path but drops the trailing slash', () => {
    const config = buildConfig({}, { base: 'https://a.com/docs/', preview: 'https://b.com' });
    assert.equal(config.base, 'https://a.com/docs');
  });

  it('rejects missing or bad input', () => {
    assert.throws(() => buildConfig({}, { preview: 'https://b.com' }), ConfigError);
    assert.throws(() => buildConfig({}, { base: 'nope', preview: 'https://b.com' }), /not a valid URL/);
    assert.throws(() => buildConfig({}, { base: 'ftp://a.com', preview: 'https://b.com' }), /http/);
    assert.throws(
      () => buildConfig({}, { base: 'https://a.com', preview: 'https://b.com', diffThreshold: 2 }),
      /between 0 and 1/,
    );
  });
});

describe('helpers', () => {
  it('parses lists and viewports', () => {
    assert.deepEqual(parseList(' /, /pricing ,,/about'), ['/', '/pricing', '/about']);
    assert.throws(() => resolveViewport('tablet'), /Unknown viewport/);
  });
});
