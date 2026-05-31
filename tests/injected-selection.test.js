import assert from 'node:assert/strict';
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
});
