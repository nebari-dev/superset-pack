import { describe, it, expect } from 'vitest';
import { remark } from 'remark';
import remarkBaseLinks, { prefixUrl } from '../src/plugins/remark-base-links';

describe('prefixUrl', () => {
  const cases: Array<{ name: string; url: string; base: string; want: string }> = [
    { name: 'base "/" leaves links unchanged', url: '/intro/', base: '/', want: '/intro/' },
    { name: 'sub-path base prefixes internal links', url: '/intro/', base: '/superset-pack/', want: '/superset-pack/intro/' },
    { name: 'prefixes image paths', url: '/img/a.png', base: '/superset-pack/', want: '/superset-pack/img/a.png' },
    { name: 'never rewrites external links', url: 'https://example.com', base: '/superset-pack/', want: 'https://example.com' },
    { name: 'never rewrites protocol-relative links', url: '//example.com/x', base: '/superset-pack/', want: '//example.com/x' },
    { name: 'never rewrites anchor-only links', url: '#section', base: '/superset-pack/', want: '#section' },
    { name: 'preserves anchors on internal links', url: '/intro/#step-1', base: '/superset-pack/', want: '/superset-pack/intro/#step-1' },
    { name: 'idempotent on already-prefixed links', url: '/superset-pack/intro/', base: '/superset-pack/', want: '/superset-pack/intro/' },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(prefixUrl(c.url, c.base)).toBe(c.want);
    });
  }
});

describe('remarkBaseLinks plugin', () => {
  it('rewrites link and image urls in a markdown document', async () => {
    const md = 'See [Intro](/intro/) and ![img](/img/a.png) and [ext](https://x.io)';
    const out = String(
      await remark().use(remarkBaseLinks, { base: '/superset-pack/' }).process(md),
    );
    expect(out).toContain('(/superset-pack/intro/)');
    expect(out).toContain('(/superset-pack/img/a.png)');
    expect(out).toContain('(https://x.io)');
  });

  it('is a no-op when base is "/"', async () => {
    const md = '[I](/intro/)';
    const out = String(await remark().use(remarkBaseLinks, { base: '/' }).process(md));
    expect(out).toContain('(/intro/)');
  });
});
