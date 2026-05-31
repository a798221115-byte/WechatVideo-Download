import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { toggleId, selectAllVisible, invertVisible } from '../src/injected/selection-state.js';

describe('injected page selection state', () => {
  test('toggles individual video IDs', () => {
    const selected = new Set();
    toggleId(selected, 'a');
    toggleId(selected, 'b');
    toggleId(selected, 'a');
    assert.deepEqual([...selected], ['b']);
  });

  test('selects and inverts visible IDs while preserving hidden selections', () => {
    const selected = new Set(['old']);
    selectAllVisible(selected, ['a', 'b']);
    invertVisible(selected, ['b', 'c']);
    assert.deepEqual([...selected].sort(), ['a', 'c', 'old']);
  });

  test('toolbar messages preserve full multiline text', () => {
    const helperSource = fs.readFileSync('src/injected/page-helper.js', 'utf8');

    assert.match(helperSource, /\.wxh-message[\s\S]*white-space: pre-wrap/);
    assert.doesNotMatch(helperSource, /\.wxh-message[\s\S]*text-overflow: ellipsis/);
  });

  test('page-side media scanner accepts Tencent tc CDN URLs', () => {
    const helperSource = fs.readFileSync('src/injected/page-helper.js', 'utf8');

    assert.match(helperSource, /host\.endsWith\('\.tc\.qq\.com'\)/);
  });

  test('page-side media scanner normalizes escaped URL forms', () => {
    const helperSource = fs.readFileSync('src/injected/page-helper.js', 'utf8');

    assert.match(helperSource, /replaceAll\('\\\\u002F', '\/'\)/);
    assert.match(helperSource, /replaceAll\('&amp;', '&'\)/);
  });
});
