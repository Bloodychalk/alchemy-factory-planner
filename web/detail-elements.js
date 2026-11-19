import { graphTheme as t } from "./graph-theme.js";
import { triangleVertices, isMerge } from "./detail-layout.js";

let registered = false;
let running = [];
const flowShapes = new Map();
const labelBoxes = new Map(),
  labelCells = new Map();
function cells(b) {
  const keys = [];
  for (let x = Math.floor(b.x1 / 320); x <= Math.floor(b.x2 / 320); x++)
    for (let y = Math.floor(b.y1 / 320); y <= Math.floor(b.y2 / 320); y++)
      keys.push(`${x}:${y}`);
  return keys;
}
function reserveLabel(id, box) {
  const old = labelBoxes.get(id);
  if (old) for (const k of cells(old)) labelCells.get(k)?.delete(id);
  labelBoxes.delete(id);
  if (!box) return;
  labelBoxes.set(id, box);
  for (const k of cells(box)) {
    if (!labelCells.has(k)) labelCells.set(k, new Set());
    labelCells.get(k).add(id);
  }
}
function labelCollision(box) {
  for (const k of cells(box))
    for (const id of labelCells.get(k) || []) {
      const b = labelBoxes.get(id);
      if (b && box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1)
        return true;
    }
  return false;
}
export function clearFlowShapes() {
  stopFlowAnimations();
  flowShapes.clear();
  labelBoxes.clear();
  labelCells.clear();
}
export function stopFlowAnimations() {
  for (const a of running) a.cancel();
  running = [];
}
export function animateFlows(graph, enabled) {
  stopFlowAnimations();
  if (!enabled || matchMedia("(prefers-reduced-motion: reduce)").matches)
    return;
  for (const e of graph.getEdgeData()) {
    if (e.style.flowStyle !== "dash") continue;
    const shape = flowShapes.get(e.id);
    const a = shape?.animate([{ lineDashOffset: 0 }, { lineDashOffset: -22 }], {
      duration: 600,
      iterations: Infinity,
    });
    if (a) running.push(a);
  }
}
const text = (text, x, y, extra = {}) => ({
  text,
  x,
  y,
  fill: t.ink,
  fontFamily: t.font,
  fontSize: 12,
  fontWeight: 700,
  textBaseline: "middle",
  pointerEvents: "none",
  ...extra,
});
export function registerDetailElements(G6, occupied) {
  if (registered) return;
  registered = true;
  class Card extends G6.Rect {
    drawKeyShape(a, container) {
      const [w, h] = a.size;
      this.upsert(
        "hard-shadow",
        "rect",
        {
          x: -w / 2 + 6,
          y: -h / 2 + 6,
          width: w,
          height: h,
          fill: t.mint,
          lineWidth: 0,
          zIndex: -2,
          pointerEvents: "none",
        },
        container,
      );
      return super.drawKeyShape(a, container);
    }
    render(a, container = this) {
      super.render(a, container);
      const f = a.factory,
        [w, h] = a.size,
        left = -w / 2,
        top = -h / 2;
      if (!f) return;
      this.upsert(
        "header",
        "rect",
        {
          x: left + 2,
          y: top + 2,
          width: w - 4,
          height: t.header - 2,
          fill: f.color,
          pointerEvents: "none",
        },
        container,
      );
      this.upsert(
        "divider",
        "path",
        {
          d: [
            ["M", left, top + t.header],
            ["L", w / 2, top + t.header],
          ],
          stroke: t.ink,
          lineWidth: 4,
          pointerEvents: "none",
        },
        container,
      );
      this.upsert(
        "port-divider",
        "path",
        {
          d: [
            ["M", 0, top + t.header + 4],
            ["L", 0, h / 2 - t.footer - 4],
          ],
          stroke: t.ink,
          lineWidth: 1,
          lineDash: [3, 3],
          pointerEvents: "none",
        },
        container,
      );
      this.upsert(
        "machine-image",
        "image",
        f.icon
          ? {
              src: f.icon,
              x: left + 8,
              y: top + 8,
              width: 22,
              height: 22,
              pointerEvents: "none",
            }
          : false,
        container,
      );
      this.upsert(
        "title",
        "text",
        text(f.title, left + (f.icon ? 36 : 10), top + 20, {
          fontSize: 14,
          wordWrap: true,
          wordWrapWidth: w - (f.icon ? 44 : 20),
          maxLines: 1,
          textOverflow: "ellipsis",
        }),
        container,
      );
      for (const p of f.ports) {
        const input = p.dir === "in",
          nameX = input ? left + 49 : 8;
        this.upsert(
          `item-${p.id}`,
          "image",
          p.icon
            ? {
                src: p.icon,
                x: input ? left + 28 : w / 2 - 45,
                y: p.y - 8,
                width: 16,
                height: 16,
                pointerEvents: "none",
              }
            : false,
          container,
        );
        this.upsert(
          `name-${p.id}`,
          "text",
          text(p.name, nameX, p.y, {
            fontSize: 11,
            wordWrap: true,
            wordWrapWidth: 40,
            maxLines: 1,
            textOverflow: "ellipsis",
          }),
          container,
        );
        this.upsert(
          `rate-${p.id}`,
          "text",
          text(p.rateText, input ? left + 5 : w / 2 - 5, p.y, {
            fontSize: 10,
            textAlign: input ? "left" : "right",
          }),
          container,
        );
      }
      this.upsert(
        "footer-line",
        "path",
        {
          d: [
            ["M", left + 8, h / 2 - t.footer],
            ["L", w / 2 - 8, h / 2 - t.footer],
          ],
          stroke: t.ink,
          lineWidth: 1,
          pointerEvents: "none",
        },
        container,
      );
      this.upsert(
        "footer",
        "text",
        text(f.footer, 0, h / 2 - 15, { textAlign: "center", fontSize: 12 }),
        container,
      );
    }
    getPortXY(a, p) {
      const [w, h] = a.size;
      return [(p.placement[0] - 0.5) * w, (p.placement[1] - 0.5) * h];
    }
  }
  class Junction extends G6.BaseNode {
    drawKeyShape(a, container) {
      // Transparent rectangular key keeps standard port bounds and hit testing.
      const [w, h] = a.size;
      return this.upsert(
        "key",
        "rect",
        {
          x: -w / 2,
          y: -h / 2,
          width: w,
          height: h,
          fill: "transparent",
          stroke: "transparent",
          lineWidth: 0,
        },
        container,
      );
    }
    getPortXY(a, p) {
      const [w, h] = a.size;
      return [(p.placement[0] - 0.5) * w, (p.placement[1] - 0.5) * h];
    }
    render(a, container = this) {
      super.render(a, container);
      const f = a.factory;
      if (!f) return;
      const n = f.node,
        points = triangleVertices(n);
      this.upsert(
        "triangle-shadow",
        "path",
        {
          d: [
            ["M", points[0][0] + 4, points[0][1] + 4],
            ["L", points[1][0] + 4, points[1][1] + 4],
            ["L", points[2][0] + 4, points[2][1] + 4],
            ["Z"],
          ],
          fill: t.mint,
          lineWidth: 0,
          zIndex: -1,
          pointerEvents: "none",
        },
        container,
      );
      this.upsert(
        "triangle",
        "path",
        {
          d: [
            ["M", ...points[0]],
            ["L", ...points[1]],
            ["L", ...points[2]],
            ["Z"],
          ],
          fill: t.yellow,
          stroke: t.ink,
          lineWidth: 4,
          shadowColor: t.mint,
          shadowBlur: 0,
          shadowOffsetX: 4,
          shadowOffsetY: 4,
          pointerEvents: "none",
        },
        container,
      );
      for (const p of f.ports) {
        const west = p.dir === "in",
          slope = isMerge(n) ? west : !west;
        const border =
          (west ? -1 : 1) *
          ((72 * Math.sqrt(3)) / 4 -
            (slope ? Math.abs(p.y + 8) * Math.sqrt(3) : 0));
        this.upsert(
          `stem-${p.id}`,
          "path",
          {
            d: [
              ["M", p.x, p.y],
              ["L", border, p.y],
            ],
            stroke: t.ink,
            lineWidth: 2.5,
            pointerEvents: "none",
          },
          container,
        );
      }
      this.upsert(
        "filter",
        "path",
        n.kind === "filter"
          ? {
              d: [
                ["M", -14, -20],
                ["L", 10, -20],
                ["L", 2, -10],
                ["L", 2, 0],
                ["L", -5, -4],
                ["L", -5, -10],
                ["Z"],
              ],
              stroke: t.ink,
              fill: t.paper,
              lineWidth: 2,
              pointerEvents: "none",
            }
          : false,
        container,
      );
      this.upsert(
        "caption",
        "text",
        text(f.caption, 0, 42, { textAlign: "center", fontSize: 11 }),
        container,
      );
    }
  }
  function decorate(Base) {
    return class Flow extends Base {
      drawKeyShape(a, container) {
        const shape = super.drawKeyShape(a, container);
        if (a.factory?.id && shape) flowShapes.set(a.factory.id, shape);
        return shape;
      }
      getKeyStyle(a) {
        return {
          ...super.getKeyStyle(a),
          lineDash: a.flowStyle === "dash" ? [6, 5] : [],
          strokeOpacity: a.flowStyle === "chevron" ? 0 : 1,
        };
      }
      drawLabelShape(a, container) {
        const f = a.factory,
          key = this.getShape("key");
        if (!f || !key) return;
        const width = f.labelWidth,
          height = 28;
        reserveLabel(f.id, null);
        let point = key.getPoint(0.5),
          visible = false;
        let leader = null;
        for (const v of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
          const p = key.getPoint(v);
          const box = p && {
            x1: p.x - width / 2 - 4,
            x2: p.x + width / 2 + 4,
            y1: p.y - 18,
            y2: p.y + 18,
          };
          if (box && !occupied(box) && !labelCollision(box)) {
            point = p;
            visible = true;
            reserveLabel(f.id, box);
            break;
          }
        }
        if (!visible) {
          outer: for (const v of [0.5, 0.35, 0.65, 0.2, 0.8]) {
            const anchor = key.getPoint(v);
            if (
              !anchor ||
              occupied({
                x1: anchor.x - 1,
                x2: anchor.x + 1,
                y1: anchor.y - 1,
                y2: anchor.y + 1,
              })
            )
              continue;
            for (const offset of [-32, 32, -48, 48, -72, 72, -104, 104]) {
              const p = { x: anchor.x, y: anchor.y + offset };
              const box = {
                x1: p.x - width / 2 - 4,
                x2: p.x + width / 2 + 4,
                y1: p.y - 18,
                y2: p.y + 18,
              };
              if (!occupied(box) && !labelCollision(box)) {
                point = p;
                visible = true;
                reserveLabel(f.id, box);
                leader = [
                  ["M", anchor.x, anchor.y],
                  ["L", p.x, p.y],
                ];
                break outer;
              }
            }
          }
        }
        this.upsert(
          "flow-label-leader",
          "path",
          leader
            ? {
                d: leader,
                stroke: t.ink,
                strokeOpacity: 0.4,
                lineWidth: 1,
                lineDash: [1, 3],
                pointerEvents: "none",
              }
            : false,
          container,
        );
        // Keep all flow information in the inspector when an unusually short belt has no label space.
        const x = point?.x || 0,
          y = point?.y || 0;
        this.upsert(
          "flow-label-shadow",
          "rect",
          visible
            ? {
                x: x - width / 2 + 2,
                y: y - height / 2 + 2,
                width,
                height,
                fill: t.mint,
                lineWidth: 0,
                pointerEvents: "none",
              }
            : false,
          container,
        );
        this.upsert(
          "flow-label-box",
          "rect",
          visible
            ? {
                x: x - width / 2,
                y: y - height / 2,
                width,
                height,
                fill: t.paper,
                stroke: t.ink,
                lineWidth: 2,
                shadowBlur: 0,
                shadowColor: t.mint,
                shadowOffsetX: 2,
                shadowOffsetY: 2,
                pointerEvents: "none",
              }
            : false,
          container,
        );
        this.upsert(
          "flow-label-icon",
          "image",
          visible && f.icon
            ? {
                src: f.icon,
                x: x - width / 2 + 6,
                y: y - 8,
                width: 16,
                height: 16,
                pointerEvents: "none",
              }
            : false,
          container,
        );
        this.upsert(
          "flow-label-text",
          "text",
          visible
            ? text(f.label, x - width / 2 + (f.icon ? 28 : 7), y, {
                fontSize: 11,
              })
            : false,
          container,
        );
      }
      render(a, container = this) {
        super.render(a, container);
        const key = this.getShape("key");
        const length = key?.getTotalLength() || 0,
          d = [];
        if (a.flowStyle === "chevron") {
          const step = Math.max(12, length / 200);
          for (let distance = step / 2; distance < length; distance += step) {
            const p = key.getPoint(distance / length),
              q = key.getPoint(Math.min(1, (distance + 1) / length));
            const angle = Math.atan2(q.y - p.y, q.x - p.x),
              dx = Math.cos(angle),
              dy = Math.sin(angle);
            d.push(
              ["M", p.x - dx * 4 + dy * 3, p.y - dy * 4 - dx * 3],
              ["L", p.x + dx * 4, p.y + dy * 4],
              ["L", p.x - dx * 4 - dy * 3, p.y - dy * 4 + dx * 3],
            );
          }
        }
        this.upsert(
          "chevrons",
          "path",
          d.length
            ? {
                d,
                stroke: a.stroke || t.ink,
                lineWidth: 1.2,
                fill: "none",
                pointerEvents: "none",
              }
            : false,
          container,
        );
      }
    };
  }
  G6.register("node", "factory-card", Card);
  G6.register("node", "factory-junction", Junction);
  G6.register("edge", "factory-flow", decorate(G6.CubicHorizontal));
  G6.register("edge", "factory-routed-flow", decorate(G6.Polyline));
}
