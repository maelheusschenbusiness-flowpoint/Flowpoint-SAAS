const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const test = require('node:test');

// Resolve through the actual consumers, including nested npm overrides.
function dependencyOf(parent, dependency) {
  return createRequire(require.resolve(parent)).resolve(dependency);
}

// Run hostile inputs separately so a regression cannot hang or crash the test runner.
function isolatedRegression(modulePath, check) {
  const result = spawnSync(process.execPath, [
    '--max-old-space-size=128',
    '-e',
    `const assert = require('node:assert/strict');
     const dependency = require(${JSON.stringify(modulePath)});
     (${check.toString()})(dependency);`,
  ], { timeout: 10_000, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || `Child exited with signal ${result.signal}`);
}

test('proxy-addr does not trust IPv4 clients through unrelated IPv6 subnets', () => {
  isolatedRegression(dependencyOf('express', 'proxy-addr'), proxyaddr => {
    assert.equal(proxyaddr.compile('::ffff:10.0.0.0/8')('203.0.113.1'), false);
    assert.equal(proxyaddr.compile('::/1')('203.0.113.1'), false);
    const trust = proxyaddr.compile('::ffff:10.0.0.0/104');
    assert.equal(trust('10.1.2.3'), true);
    assert.equal(trust('203.0.113.1'), false);
    assert.equal(proxyaddr({
      socket: { remoteAddress: '203.0.113.1' },
      headers: { 'x-forwarded-for': '10.0.0.1' },
    }, trust), '203.0.113.1');
  });
});

test('source-map-js rejects oversized indexed source-map offsets', () => {
  isolatedRegression(dependencyOf('postcss', 'source-map-js'), ({ SourceMapConsumer }) => {
    const map = { version: 3, sources: ['input.js'], names: [], mappings: 'AAAA' };
    const indexed = line => ({
      version: 3,
      sections: [{ offset: { line, column: 0 }, map }],
    });
    assert.throws(() => new SourceMapConsumer(indexed(Number.MAX_SAFE_INTEGER)), /offset/i);
    assert.throws(() => new SourceMapConsumer(indexed(-1)), /offset/i);
    assert.deepEqual(new SourceMapConsumer(indexed(0)).sources, ['input.js']);
    assert.equal(new SourceMapConsumer(map).originalPositionFor({
      line: 1, column: 0,
    }).source, 'input.js');
  });
});

test('brace-expansion handles chained, deeply nested, and rewrite-heavy patterns safely', () => {
  const sucrase = dependencyOf('tailwindcss', 'sucrase');
  const glob = createRequire(sucrase).resolve('glob');
  const minimatch = createRequire(glob).resolve('minimatch');
  const expansion = createRequire(minimatch).resolve('brace-expansion');
  isolatedRegression(expansion, expand => {
    assert.deepEqual(expand('file-{a,b}-{1..2}'), [
      'file-a-1', 'file-a-2', 'file-b-1', 'file-b-2',
    ]);
    assert.doesNotThrow(() => expand('{' + '{a},'.repeat(7000) + 'b}'));
    assert.doesNotThrow(() => expand('{{x},' + 'a,'.repeat(125000) + 'b}'));
    assert.doesNotThrow(() => expand('{a,'.repeat(4000) + 'z' + '}'.repeat(4000)));
    assert.doesNotThrow(() => expand('{'.repeat(3200) + 'a,b' + '}'.repeat(3200)));
    assert.doesNotThrow(() => expand('{a}' + '}'.repeat(128000) + ',z}'));
  });
});

for (const consumer of ['micromatch', 'chokidar']) {
  test(`braces used by ${consumer} rejects excessive nesting without stack exhaustion`, () => {
    const parent = dependencyOf('tailwindcss', consumer);
    const braces = createRequire(parent).resolve('braces');
    isolatedRegression(braces, braces => {
      assert.deepEqual(braces.expand('src/{pages,components}/*.{ts,tsx}'), [
        'src/pages/*.ts', 'src/pages/*.tsx', 'src/components/*.ts', 'src/components/*.tsx',
      ]);
      assert.equal(braces.compile('a/{b,c}/d'), 'a/(b|c)/d');
      const excessive = '{'.repeat(4000) + 'a,b' + '}'.repeat(4000);
      for (const method of ['parse', 'compile', 'expand', 'stringify']) {
        assert.throws(() => braces[method](excessive), /exceeds max depth/);
      }
      const parentheses = '('.repeat(4000) + 'x' + ')'.repeat(4000);
      for (const method of ['compile', 'expand', 'stringify']) {
        assert.throws(() => braces[method](parentheses), /exceeds max depth/);
        // These methods also accept ASTs directly, bypassing the parser.
        let ast = { type: 'text', value: 'x' };
        for (let i = 0; i < 4000; i++) ast = { type: 'root', nodes: [ast] };
        assert.throws(() => braces[method](ast), /exceeds max depth/);
      }
    });
  });
}

test('ip-address bounds invalid input and correctly classifies addresses and subnets', () => {
  isolatedRegression(dependencyOf('express-rate-limit', 'ip-address'), ({ Address4, Address6 }) => {
    assert.equal(new Address6('64:ff9b:1:7f00:0:100::').isPrivate(), true);
    assert.equal(new Address6('64:ff9b:1::7f00:1').isPrivate(), true);
    for (const address of ['fe81::1', 'febf::1', 'fe80:0:0:1::1']) {
      assert.equal(new Address6(address).isLinkLocal(), true);
    }
    const v4 = new Address4('10.0.0.0/8');
    const v6 = new Address6('a00::1');
    assert.equal(v6.isInSubnet(v4), false);
    assert.equal(v6.isHostInSubnet(v4), false);
    assert.equal(new Address4('32.1.13.184').isInSubnet(new Address6('2001:db8::/32')), false);
    assert.equal(new Address4('10.0.0.1').isInSubnet(v4), true);
    assert.equal(new Address6('2001:db8::1').isInSubnet(new Address6('2001:db8::/32')), true);
    assert.equal(Address6.isValid('!'.repeat(1024 * 1024)), false);
    assert.throws(() => new Address6('!'.repeat(1024 * 1024)), { name: 'AddressError' });
  });
});
