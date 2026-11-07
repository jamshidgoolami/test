import test from 'node:test';
import assert from 'node:assert/strict';
import { autoLayoutNodes } from '../src/lib/diagram-layout.ts';
import type { DiagramFlowEdge, DiagramFlowNode } from '../src/lib/diagrams.ts';

function node(id: string, x: number, y: number, extra: Partial<DiagramFlowNode> = {}): DiagramFlowNode {
  return {
    id,
    type: 'device',
    position: { x, y },
    width: 190,
    height: 86,
    data: { label: id },
    ...extra,
  } as DiagramFlowNode;
}

function edge(source: string, target: string, kind: 'fiber' | 'copper' = 'fiber'): DiagramFlowEdge {
  return {
    id: `${source}-${target}`,
    type: 'diagram',
    source,
    target,
    sourceHandle: 'right',
    targetHandle: 'left',
    data: { kind, label: '' },
  } as DiagramFlowEdge;
}

function byId(nodes: DiagramFlowNode[], id: string) {
  return nodes.find((item) => item.id === id)!;
}

function overlaps(a: DiagramFlowNode, b: DiagramFlowNode): boolean {
  const aw = a.width ?? 190;
  const ah = a.height ?? 86;
  const bw = b.width ?? 190;
  const bh = b.height ?? 86;
  return a.position.x < b.position.x + bw && a.position.x + aw > b.position.x && a.position.y < b.position.y + bh && a.position.y + ah > b.position.y;
}

test('hierarchical layout puts downstream devices in later rows without overlap', () => {
  const nodes = [node('c', 0, 0), node('a', 20, 30), node('b', 40, 10)];
  const result = autoLayoutNodes(nodes, [edge('a', 'b'), edge('b', 'c')], { mode: 'hierarchical' });
  const a = byId(result, 'a');
  const b = byId(result, 'b');
  const c = byId(result, 'c');
  assert.ok(a.position.y < b.position.y);
  assert.ok(b.position.y < c.position.y);
  for (let i = 0; i < result.length; i += 1) {
    for (let j = i + 1; j < result.length; j += 1) assert.equal(overlaps(result[i], result[j]), false);
  }
  // ترتیب/شناسه‌ها تغییر نمی‌کنند.
  assert.deepEqual(result.map((item) => item.id), ['c', 'a', 'b']);
});

test('horizontal layout advances layers along x', () => {
  const result = autoLayoutNodes([node('a', 0, 0), node('b', 0, 0)], [edge('a', 'b')], {
    mode: 'horizontal',
  });
  assert.ok(byId(result, 'a').position.x < byId(result, 'b').position.x);
});

test('locked nodes keep their exact position and other nodes avoid them', () => {
  const result = autoLayoutNodes(
    [node('a', 500, 400, { data: { label: 'a', locked: true } }), node('b', 500, 400)],
    [edge('b', 'a')],
    { mode: 'hierarchical' }
  );
  assert.deepEqual(byId(result, 'a').position, { x: 500, y: 400 });
  assert.equal(overlaps(byId(result, 'a'), byId(result, 'b')), false);
});

test('grouped layout keeps members inside their group rectangle', () => {
  const group: DiagramFlowNode = {
    id: 'g',
    type: 'group',
    position: { x: 0, y: 0 },
    width: 420,
    height: 300,
    data: { label: 'گروه', color: '#60a5fa' },
    zIndex: -1,
  } as DiagramFlowNode;
  const members = [node('a', 40, 80), node('b', 200, 80), node('c', 80, 180)];
  const result = autoLayoutNodes([group, ...members], [edge('a', 'b')], { mode: 'grouped' });
  const box = byId(result, 'g');
  for (const child of ['a', 'b', 'c']) {
    const item = byId(result, child);
    assert.ok(item.position.x >= box.position.x, `${child} inside x`);
    assert.ok(item.position.x + (item.width ?? 190) <= box.position.x + (box.width ?? 0));
    assert.ok(item.position.y >= box.position.y, `${child} inside y`);
    assert.ok(item.position.y + (item.height ?? 86) <= box.position.y + (box.height ?? 0));
  }
});

test('a diagram without edges is arranged in a non-overlapping grid and data is untouched', () => {
  const nodes = Array.from({ length: 9 }, (_, index) => node(`n${index}`, index, index));
  const result = autoLayoutNodes(nodes, [], { mode: 'hierarchical' });
  for (let i = 0; i < result.length; i += 1) {
    for (let j = i + 1; j < result.length; j += 1) assert.equal(overlaps(result[i], result[j]), false);
  }
  assert.equal(result[0].data.label, 'n0');
  assert.equal(result.length, 9);
});
