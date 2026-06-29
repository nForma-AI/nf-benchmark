'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveSut, readSutVersion } = require('../lib/runner.cjs');

function tmpSut(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sut-'));
  const bin = path.join(dir, 'nf-solve.cjs');
  fs.writeFileSync(bin, '#!/usr/bin/env node\n');
  if (version) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }));
  return { dir, bin };
}

test('resolveSut: an explicit --sut/opts.sut pin is used and labeled "pinned"', () => {
  const { bin } = tmpSut('9.9.9');
  const r = resolveSut('/does/not/matter', { sut: bin });
  assert.strictEqual(r.bin, bin);
  assert.strictEqual(r.source, 'pinned');
  assert.strictEqual(r.version, '9.9.9');
});

test('resolveSut: opts.sut takes precedence over NF_SUT env', () => {
  const a = tmpSut('1.0.0'), b = tmpSut('2.0.0');
  const prev = process.env.NF_SUT;
  process.env.NF_SUT = b.bin;
  try {
    const r = resolveSut('/x', { sut: a.bin });
    assert.strictEqual(r.bin, a.bin, 'opts.sut wins over env');
  } finally {
    if (prev === undefined) delete process.env.NF_SUT; else process.env.NF_SUT = prev;
  }
});

test('resolveSut: NF_SUT env pin is honored when no opts.sut', () => {
  const { bin } = tmpSut('3.1.4');
  const prev = process.env.NF_SUT;
  process.env.NF_SUT = bin;
  try {
    const r = resolveSut('/x', {});
    assert.strictEqual(r.bin, bin);
    assert.strictEqual(r.source, 'pinned');
  } finally {
    if (prev === undefined) delete process.env.NF_SUT; else process.env.NF_SUT = prev;
  }
});

test('resolveSut: a non-existent pin throws (no silent fallback)', () => {
  assert.throws(() => resolveSut('/x', { sut: '/no/such/nf-solve.cjs' }), /SUT not found/);
});

test('resolveSut: an "npm:" spec resolves the cached bundled nf-solve (complete decoupling, no QGSD)', () => {
  // Pre-populate the cache so this is a no-network cache-hit (the install path is
  // exercised live elsewhere). Mirrors resolveNpmSut's content-addressed layout.
  const spec = '@nforma.ai/nforma@0.0.0-test';
  const cacheDir = path.join(os.homedir(), '.cache', 'nf-benchmark-sut', spec.replace(/[^a-zA-Z0-9._@-]/g, '_'));
  const pkgDir = path.join(cacheDir, 'node_modules', '@nforma.ai', 'nforma', 'bin');
  fs.mkdirSync(pkgDir, { recursive: true });
  const bin = path.join(pkgDir, 'nf-solve.cjs');
  fs.writeFileSync(bin, '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(pkgDir, '..', 'package.json'), JSON.stringify({ version: '0.0.0-test' }));
  try {
    const r = resolveSut('/anything', { sut: 'npm:' + spec });
    assert.strictEqual(r.bin, bin, 'resolves the npm-bundled nf-solve, not a source checkout');
    assert.strictEqual(r.source, 'npm:' + spec);
    assert.strictEqual(r.version, '0.0.0-test');
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('readSutVersion: finds the nearest package.json version, else "unknown"', () => {
  const { bin } = tmpSut('4.5.6');
  assert.strictEqual(readSutVersion(bin), '4.5.6');
  const noVer = tmpSut(null);
  assert.strictEqual(readSutVersion(noVer.bin), 'unknown');
});
