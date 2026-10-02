import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpstreamUrl } from '../lib/proxy.js';

test('proxy forwards only whitelisted params to the fixed upstream', () => {
  const url = new URL(
    buildUpstreamUrl(new URLSearchParams('q=voice&ai_startups=1&index=web&url=http://evil&content=1&sort=dr')),
  );
  assert.equal(url.origin + url.pathname, 'https://freeserp.ai/api.php');
  assert.equal(url.searchParams.get('q'), 'voice');
  assert.equal(url.searchParams.get('sort'), 'dr');
  assert.equal(url.searchParams.get('index'), null);
  assert.equal(url.searchParams.get('url'), null);
  assert.equal(url.searchParams.get('content'), null);
  assert.equal(url.searchParams.get('project'), 'ai-radar-demo');
});

test('proxy caps parameter length', () => {
  const url = new URL(buildUpstreamUrl(new URLSearchParams({ q: 'x'.repeat(5000), size: '100000' })));
  assert.equal(url.searchParams.get('q').length, 200);
  assert.equal(url.searchParams.get('size'), '100');
});
