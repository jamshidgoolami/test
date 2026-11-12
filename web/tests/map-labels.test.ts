import test from 'node:test';
import assert from 'node:assert/strict';

import { escapeLabel, labelSize, labelVisible } from '../src/features/map/lib/mapLabels.ts';

test('map place labels follow the existing zoom visibility bands', () => {
  assert.equal(labelVisible('country', 7.5), true);
  assert.equal(labelVisible('country', 8), false);
  assert.equal(labelVisible('city', 3.9), false);
  assert.equal(labelVisible('city', 4), true);
  assert.equal(labelVisible('town', 7), true);
  assert.equal(labelVisible('village', 10), true);
  assert.equal(labelVisible('hamlet', 11), false);
  assert.equal(labelVisible('hamlet', 12), true);
  assert.equal(labelVisible('unknown', 20), false);
});

test('map place labels keep the existing size hierarchy', () => {
  assert.equal(labelSize('country', 4), 15);
  assert.equal(labelSize('province', 4), 13);
  assert.equal(labelSize('city', 9), 13);
  assert.equal(labelSize('city', 10), 15);
  assert.equal(labelSize('town', 10), 12.5);
  assert.equal(labelSize('village', 10), 11.5);
  assert.equal(labelSize('suburb', 15), 11);
});

test('place names are escaped before being placed in HTML labels', () => {
  assert.equal(escapeLabel(`<b>"Tehran" & 'Qom'</b>`), '&lt;b&gt;&quot;Tehran&quot; &amp; &#39;Qom&#39;&lt;/b&gt;');
});
