import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeColumnStats, findFirstNumericColumn, computeBasicStats } from '../../src/workflows/legacy/data.ts';
import type { ParsedSpreadsheet } from '../../src/workflows/legacy/data.ts';

const sample: ParsedSpreadsheet = {
  headers: ['name', 'score'],
  rows: [
    ['Alice', '10'],
    ['Bob', '20'],
    ['Cara', 'n/a'],
    ['Dan', '30'],
  ],
  sheetName: 'Sheet1',
};

test('computeColumnStats ignores non-numeric cells and computes correctly', () => {
  const stats = computeColumnStats(sample, 1);
  assert.ok(stats);
  assert.equal(stats!.count, 3);
  assert.equal(stats!.sum, 60);
  assert.equal(stats!.avg, 20);
  assert.equal(stats!.max, 30);
  assert.equal(stats!.min, 10);
});

test('computeColumnStats returns null for an all-non-numeric column', () => {
  const stats = computeColumnStats(sample, 0);
  assert.equal(stats, null);
});

test('findFirstNumericColumn finds the score column, not the name column', () => {
  assert.equal(findFirstNumericColumn(sample), 1);
});

test('computeBasicStats keys results by header name', () => {
  const stats = computeBasicStats(sample);
  assert.equal(stats.name, null);
  assert.equal(stats.score?.count, 3);
});
