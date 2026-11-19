import { graphTheme as t } from "./graph-theme.js";

export const DETAIL_LAYOUT_VERSION = 2;
export const isJunction = (n) =>
  ["splitter", "merger", "filter", "junction"].includes(n.kind);
export const isMerge = (n) => n.ports.filter((p) => p.dir === "in").length > 1;
export function triangleVertices(n) {
  const x = (72 * Math.sqrt(3)) / 4,
    sign = isMerge(n) ? -1 : 1;
  return [
    [-sign * x, -44],
    [-sign * x, 28],
    [sign * x, -8],
  ];
}
export function nodeSpec(n) {
  const ins = n.ports.filter((p) => p.dir === "in"),
    outs = n.ports.filter((p) => p.dir === "out");
  const junction = isJunction(n),
    width = junction ? 96 : t.cardWidth;
  const height = junction
    ? 96
    : t.header + Math.max(1, ins.length, outs.length) * t.row + t.footer;
  const ports = n.ports.map((p) => {
    const list = p.dir === "in" ? ins : outs,
      index = list.indexOf(p);
    const y = junction
      ? -8 + ((index + 1) / (list.length + 1) - 0.5) * 72
      : -height / 2 + t.header + (index + 0.5) * t.row;
    return { ...p, x: p.dir === "in" ? -width / 2 : width / 2, y };
  });
  return { width, height, ports };
}

// Collapse only the layout input. The rendered and saved networks keep every device and belt.
export function prepareDetailLayout(detail) {
  const specs = new Map(detail.nodes.map((n) => [n.id, nodeSpec(n)]));
  const machines = new Map(
    detail.nodes.filter((n) => n.kind === "machine").map((n) => [n.id, n]),
  );
  const heaters = new Map();
  for (const e of detail.edges.filter((e) => e.kind === "heat"))
    if (machines.has(e.target)) heaters.set(e.source, e.target);
  const blocks = new Map(),
    membership = new Map();
  for (const n of detail.nodes) {
    const owner = machines.get(heaters.get(n.id));
    const group =
      n.kind === "machine" ? n.group || n.id : owner?.group || owner?.id;
    const id = group ? `stage:${group}` : `single:${n.id}`;
    if (!blocks.has(id))
      blocks.set(id, { id, nodes: [], cells: [], offsets: new Map() });
    blocks.get(id).nodes.push(n);
    membership.set(n.id, id);
  }
  for (const b of blocks.values()) {
    const units = b.nodes.filter((n) => n.kind === "machine");
    if (!units.length) {
      const n = b.nodes[0],
        s = specs.get(n.id);
      Object.assign(b, {
        width: s.width,
        height: s.height,
        columns: 1,
        rows: 1,
      });
      b.offsets.set(n.id, { x: s.width / 2, y: s.height / 2 });
      continue;
    }
    for (const n of units) {
      const companions = b.nodes.filter((h) => heaters.get(h.id) === n.id);
      const ids = [n.id, ...companions.map((h) => h.id)];
      b.cells.push({
        ids,
        width: Math.max(...ids.map((id) => specs.get(id).width)),
        height:
          ids.reduce((v, id) => v + specs.get(id).height, 0) +
          (ids.length - 1) * 24,
      });
    }
    const cellWidth = Math.max(...b.cells.map((c) => c.width));
    const cellHeight = Math.max(...b.cells.map((c) => c.height));
    b.columns =
      units.length <= 4
        ? 1
        : Math.max(
            2,
            Math.ceil(
              Math.sqrt(
                (units.length * (cellHeight + t.rowGap)) /
                  (cellWidth + t.columnGap),
              ),
            ),
          );
    b.rows = Math.ceil(units.length / b.columns);
    b.width = b.columns * cellWidth + (b.columns - 1) * t.columnGap;
    b.height = b.rows * cellHeight + (b.rows - 1) * t.rowGap;
    b.cells.forEach((cell, i) => {
      const x =
        Math.floor(i / b.rows) * (cellWidth + t.columnGap) + cellWidth / 2;
      let y = (i % b.rows) * (cellHeight + t.rowGap);
      for (const id of cell.ids) {
        const s = specs.get(id);
        b.offsets.set(id, {
          x,
          y: y + s.height / 2,
          rowTop: (i % b.rows) * (cellHeight + t.rowGap),
        });
        y += s.height + 24;
      }
    });
  }
  const connections = new Map();
  for (const e of detail.edges) {
    const source = membership.get(e.source),
      target = membership.get(e.target);
    const key = `${source}\0${target}`;
    if (source !== target && !connections.has(key))
      connections.set(key, {
        id: `layout:${connections.size}`,
        sources: [source + ":out"],
        targets: [target + ":in"],
      });
  }
  return {
    specs,
    blocks,
    membership,
    input: {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.spacing.nodeNode": "64",
        "elk.layered.spacing.nodeNodeBetweenLayers": String(t.columnGap),
        "elk.randomSeed": "1",
      },
      children: [...blocks.values()].map(({ id, width, height }) => ({
        id,
        width,
        height,
        layoutOptions: { "elk.portConstraints": "FIXED_SIDE" },
        ports: [
          { id: id + ":in", layoutOptions: { "elk.port.side": "WEST" } },
          { id: id + ":out", layoutOptions: { "elk.port.side": "EAST" } },
        ],
      })),
      edges: [...connections.values()],
    },
  };
}
export function expandDetailLayout(prepared, layout) {
  const result = new Map();
  for (const placed of layout.children) {
    const block = prepared.blocks.get(placed.id);
    for (const [id, offset] of block.offsets)
      result.set(id, {
        ...prepared.specs.get(id),
        x: placed.x + offset.x,
        y: placed.y + offset.y,
        rowTop: placed.y + (offset.rowTop ?? 0),
      });
  }
  return result;
}

// The ELK macro route already avoids process blocks. Extend it through the known
// matrix corridors instead of asking A* to rediscover thousands of identical paths.
export function matrixRoutes(detail, prepared, layout, coords) {
  const placed = new Map(layout.children.map((b) => [b.id, b]));
  const macro = new Map();
  const byId = new Map(layout.edges.map((e) => [e.id, e]));
  for (const e of prepared.input.edges) {
    const route = byId.get(e.id)?.sections?.[0];
    if (route)
      macro.set(
        e.sources[0].slice(0, -4) + "\0" + e.targets[0].slice(0, -3),
        [route.startPoint, ...(route.bendPoints || []), route.endPoint].map(
          (p) => [p.x, p.y],
        ),
      );
  }
  const routes = new Map();
  for (const e of detail.edges) {
    const a = coords.get(e.source),
      b = coords.get(e.target);
    const p = a.ports.find((p) => p.id === e.sourcePort),
      q = b.ports.find((p) => p.id === e.targetPort);
    const start = [a.x + p.x, a.y + p.y],
      end = [b.x + q.x, b.y + q.y];
    const source = prepared.membership.get(e.source),
      target = prepared.membership.get(e.target);
    const sb = placed.get(source),
      tb = placed.get(target);
    const manySource = prepared.blocks.get(source).cells.length > 0;
    const manyTarget = prepared.blocks.get(target).cells.length > 0;
    const sx = sb.x + sb.width + 28,
      tx = tb.x - 28;
    const points = [start];
    if (manySource)
      points.push(
        [start[0] + 28, start[1]],
        [start[0] + 28, a.rowTop - 24],
        [sx, a.rowTop - 24],
      );
    else points.push([sx, start[1]]);
    if (source === target) {
      points.push([sx, sb.y - 32], [tx, sb.y - 32]);
    } else {
      const middle = macro.get(source + "\0" + target);
      if (middle) {
        points.push([sx, middle[0][1]], ...middle.slice(1, -1), [
          tx,
          middle.at(-1)[1],
        ]);
      } else
        points.push(
          [sx, Math.min(sb.y, tb.y) - 32],
          [tx, Math.min(sb.y, tb.y) - 32],
        );
    }
    if (manyTarget)
      points.push(
        [tx, b.rowTop - 24],
        [end[0] - 28, b.rowTop - 24],
        [end[0] - 28, end[1]],
      );
    else points.push([tx, end[1]]);
    points.push(end);
    routes.set(
      e.id,
      points
        .slice(1, -1)
        .filter(
          (p, i, all) => !i || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1],
        ),
    );
  }
  return routes;
}
export function restoredPositions(saved, fingerprint) {
  return new Map(
    saved?.layoutVersion === DETAIL_LAYOUT_VERSION &&
    saved.key === fingerprint &&
    Array.isArray(saved.positions)
      ? saved.positions
          .filter(
            (p) =>
              Number.isFinite(p.x) &&
              Number.isFinite(p.y) &&
              Math.abs(p.x) < 1e6 &&
              Math.abs(p.y) < 1e6,
          )
          .map((p) => [p.id, p])
      : [],
  );
}

export function obstacleIndex(boxes) {
  const buckets = new Map(),
    size = 320;
  for (const b of boxes) {
    for (let x = Math.floor(b.x1 / size); x <= Math.floor(b.x2 / size); x++)
      for (let y = Math.floor(b.y1 / size); y <= Math.floor(b.y2 / size); y++) {
        const k = `${x}:${y}`;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(b);
      }
  }
  return (b, omit = []) => {
    for (let x = Math.floor(b.x1 / size); x <= Math.floor(b.x2 / size); x++)
      for (let y = Math.floor(b.y1 / size); y <= Math.floor(b.y2 / size); y++)
        for (const a of buckets.get(`${x}:${y}`) || [])
          if (
            !omit.includes(a.id) &&
            b.x1 < a.x2 &&
            b.x2 > a.x1 &&
            b.y1 < a.y2 &&
            b.y2 > a.y1
          )
            return true;
    return false;
  };
}
