import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  prepareDetailLayout,
  expandDetailLayout,
  triangleVertices,
  nodeSpec,
  restoredPositions,
  obstacleIndex,
  matrixRoutes,
} from "../web/detail-layout.js";
const mod = { exports: {} };
new Function(
  "module",
  "exports",
  fs.readFileSync(
    new URL("../web/vendor/elk.bundled.js", import.meta.url),
    "utf8",
  ),
)(mod, mod.exports);
const ELK = mod.exports;
const machine = (i, group = "plank") => ({
  id: "m" + i,
  kind: "machine",
  group,
  machine: "Table Saw",
  label: `Table Saw #${i}`,
  load: 1,
  ports: [
    { id: `m${i}:in`, dir: "in", item: "Logs", rate: 0.15 },
    { id: `m${i}:out`, dir: "out", item: "Plank", rate: 30 },
  ],
});
const detail = (count) => ({
  nodes: Array.from({ length: count }, (_, i) => machine(i + 1)),
  edges: [],
});
function nonOverlapping(coords) {
  const boxes = [...coords.values()];
  for (let i = 0; i < boxes.length; i++)
    for (let j = 0; j < i; j++) {
      const a = boxes[i],
        b = boxes[j];
      assert.ok(
        Math.abs(a.x - b.x) >= (a.width + b.width) / 2 ||
          Math.abs(a.y - b.y) >= (a.height + b.height) / 2,
      );
    }
}
test("four devices stay in one column; five and a thousand form compact matrices without aggregating", async () => {
  for (const count of [3, 4, 5, 1000]) {
    const d = detail(count),
      before = JSON.stringify(d),
      p = prepareDetailLayout(d),
      b = [...p.blocks.values()][0];
    assert.equal(b.columns === 1, count <= 4);
    const start = performance.now(),
      engine = new ELK();
    const l = await engine.layout(p.input),
      coords = expandDetailLayout(p, l);
    assert.ok(performance.now() - start < 10000);
    assert.equal(coords.size, count);
    nonOverlapping(coords);
    assert.equal(JSON.stringify(d), before);
    assert.equal(coords.get("m1").x, coords.get("m2").x);
    assert.ok(coords.get("m1").y < coords.get("m2").y);
  }
});
test("same model with different process keys stays separate and heaters follow individual owners", async () => {
  const d = detail(3);
  d.nodes.push(machine(4, "another-recipe"));
  d.nodes.push({
    id: "h",
    kind: "heater",
    machine: "Stone Furnace",
    ports: [{ id: "h:out", dir: "out", item: "热量", rate: 1 }],
  });
  d.edges.push({ id: "heat", kind: "heat", source: "h", target: "m2" });
  const p = prepareDetailLayout(d);
  assert.notEqual(p.membership.get("m1"), p.membership.get("m4"));
  assert.equal(p.membership.get("m2"), p.membership.get("h"));
  const coords = expandDetailLayout(p, await new ELK().layout(p.input));
  assert.equal(coords.get("h").x, coords.get("m2").x);
  assert.ok(coords.get("h").y > coords.get("m2").y);
  nonOverlapping(coords);
});
test("parallel belts collapse only in the layout input and retain unique macro edge identifiers", async () => {
  const d = detail(5);
  d.nodes.push(
    { id: "s", kind: "splitter", ports: [] },
    { id: "t", kind: "terminal", ports: [] },
  );
  d.edges = d.nodes.slice(0, 5).flatMap((n) => [
    { id: "in-" + n.id, source: "s", target: n.id },
    { id: "out-" + n.id, source: n.id, target: "t" },
  ]);
  const before = JSON.stringify(d),
    p = prepareDetailLayout(d);
  assert.equal(p.input.edges.length, 2);
  assert.equal(new Set(p.input.edges.map((e) => e.id)).size, 2);
  assert.equal(
    expandDetailLayout(p, await new ELK().layout(p.input)).size,
    d.nodes.length,
  );
  assert.equal(JSON.stringify(d), before);
});
test("split and merge are equal-sided triangles with opposite tips but left inputs and right outputs", () => {
  for (const merge of [false, true]) {
    const n = {
      kind: merge ? "merger" : "splitter",
      ports: (merge ? ["in", "in", "out"] : ["in", "out", "out"]).map(
        (dir, i) => ({ id: String(i), dir }),
      ),
    };
    const vertices = triangleVertices(n);
    const lengths = vertices.map((a, i) =>
      Math.hypot(
        a[0] - vertices[(i + 1) % 3][0],
        a[1] - vertices[(i + 1) % 3][1],
      ),
    );
    assert.ok(lengths.every((l) => Math.abs(l - 72) < 1e-8));
    assert.equal(vertices[2][0] > vertices[0][0], !merge);
    assert.ok(
      nodeSpec(n).ports.every((p) => (p.dir === "in" ? p.x < 0 : p.x > 0)),
    );
  }
});
test("old layouts reflow; compatible new positions restore and malformed coordinates do not", () => {
  const positions = [
    { id: "m1", x: 123, y: 456 },
    { id: "bad", x: Infinity, y: 0 },
  ];
  assert.equal(restoredPositions({ key: "same", positions }, "same").size, 0);
  assert.deepEqual(
    [
      ...restoredPositions(
        { layoutVersion: 2, key: "same", positions },
        "same",
      ).values(),
    ],
    [positions[0]],
  );
  assert.equal(
    restoredPositions({ layoutVersion: 2, key: "other", positions }, "same")
      .size,
    0,
  );
});
test("matrix corridors retain each edge and keep horizontal and vertical runs outside other cards", async () => {
  const d = detail(5);
  d.nodes.push({
    id: "buy",
    kind: "purchase",
    ports: [{ id: "buy:out", dir: "out" }],
  });
  d.edges = d.nodes
    .slice(0, 5)
    .map((n) => ({
      id: "edge-" + n.id,
      source: "buy",
      target: n.id,
      sourcePort: "buy:out",
      targetPort: n.ports[0].id,
    }));
  const p = prepareDetailLayout(d),
    layout = await new ELK().layout(p.input),
    coords = expandDetailLayout(p, layout);
  const routes = matrixRoutes(d, p, layout, coords);
  assert.equal(routes.size, d.edges.length);
  for (const e of d.edges) {
    const a = coords.get(e.source),
      b = coords.get(e.target);
    const from = a.ports.find((x) => x.id === e.sourcePort),
      to = b.ports.find((x) => x.id === e.targetPort);
    const points = [
      [a.x + from.x, a.y + from.y],
      ...routes.get(e.id),
      [b.x + to.x, b.y + to.y],
    ];
    assert.ok(points.flat().every(Number.isFinite));
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1],
        [x2, y2] = points[i];
      assert.ok(x1 === x2 || y1 === y2);
      for (const [id, c] of coords) {
        if (id === e.source || id === e.target) continue;
        const crossing =
          x1 === x2
            ? x1 > c.x - c.width / 2 &&
              x1 < c.x + c.width / 2 &&
              Math.min(y1, y2) < c.y + c.height / 2 &&
              Math.max(y1, y2) > c.y - c.height / 2
            : y1 > c.y - c.height / 2 &&
              y1 < c.y + c.height / 2 &&
              Math.min(x1, x2) < c.x + c.width / 2 &&
              Math.max(x1, x2) > c.x - c.width / 2;
        assert.equal(crossing, false, `${e.id} crosses ${id}`);
      }
    }
  }
});
test("flow-label obstacle queries include card boundaries and allow unrelated empty space", () => {
  const hit = obstacleIndex([{ id: "m", x1: -10, x2: 100, y1: 0, y2: 100 }]);
  assert.equal(hit({ x1: 90, x2: 110, y1: 20, y2: 40 }), true);
  assert.equal(hit({ x1: 110, x2: 150, y1: 20, y2: 40 }), false);
  assert.equal(hit({ x1: 90, x2: 110, y1: 20, y2: 40 }, ["m"]), false);
});
