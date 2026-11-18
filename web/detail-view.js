let libraries;
function loadLibraries() {
  return (libraries ??= Promise.all(
    ["g6.min.js", "elk.bundled.js"].map(
      (file) =>
        new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = new URL("./vendor/" + file, import.meta.url).href;
          script.onload = resolve;
          script.onerror = () => {
            libraries = null;
            reject(new Error("详细图资源加载失败"));
          };
          document.head.append(script);
        }),
    ),
  ));
}
let generation = 0;
let graph = null,
  key = "",
  timer = null,
  layoutEngine = null;
const $ = (id) => document.getElementById(id);
export function destroyDetail() {
  generation++;
  clearTimeout(timer);
  layoutEngine?.terminateWorker();
  layoutEngine = null;
  graph?.destroy();
  graph = null;
  key = "";
  $("detail-inspect")?.classList.add("hidden");
}
function fingerprint(d) {
  let h = 2166136261;
  for (const c of JSON.stringify([d.nodes, d.edges]))
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return String(h >>> 0);
}
let topology = null;
export function detailLayout() {
  return graph
    ? {
        key: topology,
        positions: graph
          .getNodeData()
          .map((n) => ({ id: n.id, x: n.style.x, y: n.style.y })),
      }
    : null;
}
export async function renderDetail(plan, tr = {}, saved = null) {
  if (!plan) return;
  const d = plan.detail;
  for (const id of ["detail-fit", "detail-zoom-in", "detail-zoom-out"])
    $(id).disabled = d?.status !== "ready";
  if (d?.status !== "ready") {
    $("detail-error").classList.remove("hidden");
    $("detail-error").textContent = (d?.issues || ["详细规划不可用"]).join(
      "\n",
    );
    $("detail-canvas").classList.add("hidden");
    $("detail-count").textContent = "";
    return;
  }
  $("detail-error").classList.add("hidden");
  $("detail-canvas").classList.remove("hidden");
  if (key === plan.createdAt && graph) {
    graph.resize($("detail-canvas").clientWidth, 660);
    return;
  }
  const loadingGeneration = generation;
  await loadLibraries();
  if (loadingGeneration !== generation) return;
  if (key === plan.createdAt && (graph || layoutEngine)) return;
  destroyDetail();
  key = plan.createdAt;
  const current = key;
  const currentGeneration = generation;
  const name = (s) => tr.items?.[s] || tr.machines?.[s] || s;
  const priorityPorts = new Set(
    d.nodes.flatMap((n) => n.ports.filter((p) => p.priority).map((p) => p.id)),
  );
  const count = d.nodes.filter((n) => n.kind !== "terminal").length;
  $("detail-count").textContent =
    `${count} 设备/构件 · ${d.edges.filter((e) => e.kind === "belt").length} 带段`;
  layoutEngine = new window.ELK({
    workerFactory: () =>
      new Worker(new URL("./vendor/elk-worker.min.js", import.meta.url)),
  });
  const input = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "64",
      "elk.layered.spacing.nodeNodeBetweenLayers": "220",
      "elk.portConstraints": "FIXED_ORDER",
    },
    children: d.nodes.map((n) => ({
      id: n.id,
      width: 240,
      height: Math.max(100, n.ports.length * 24 + 64),
      layoutOptions: { "elk.portConstraints": "FIXED_ORDER" },
      ports: n.ports.map((p) => ({
        id: p.id,
        width: 8,
        height: 8,
        layoutOptions: { "elk.port.side": p.dir === "in" ? "WEST" : "EAST" },
      })),
    })),
    edges: d.edges.map((e) => ({
      id: e.id,
      sources: [e.sourcePort],
      targets: [e.targetPort],
    })),
  };
  const engine = layoutEngine;
  let timeout;
  let layout;
  try {
    layout = await Promise.race([
      engine.layout(input),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          engine.terminateWorker();
          reject(new Error("详细布局超过10秒"));
        }, 10000);
        timer = timeout;
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    engine.terminateWorker();
    if (layoutEngine === engine) layoutEngine = null;
  }
  if (current !== key || currentGeneration !== generation) return;
  const coords = new Map(layout.children.map((n) => [n.id, n]));
  topology = fingerprint(d);
  const previous =
    saved?.key === topology && Array.isArray(saved.positions)
      ? new Map(
          saved.positions
            .filter(
              (n) =>
                Number.isFinite(n.x) &&
                Number.isFinite(n.y) &&
                Math.abs(n.x) < 1e6 &&
                Math.abs(n.y) < 1e6,
            )
            .map((n) => [n.id, n]),
        )
      : new Map();
  graph = new window.G6.Graph({
    container: $("detail-canvas"),
    height: 660,
    autoResize: true,
    autoFit: "view",
    padding: 24,
    data: {
      nodes: d.nodes.map((n) => {
        const c = coords.get(n.id),
          old = previous.get(n.id),
          ports = c.ports.map((p) => ({
            key: p.id,
            placement: [p.x / c.width, p.y / c.height],
            r: 4,
            fill: n.ports.find((q) => q.id === p.id)?.priority ? "#ff6b6b" : "#4ecdc4",
            stroke: "#000",
            lineWidth: 2,
          }));
        return {
          id: n.id,
          data: { ...n },
          style: {
            x: old?.x ?? c.x + c.width / 2,
            y: old?.y ?? c.y + c.height / 2,
            size: [c.width, c.height],
            ports,
            labelText:
              n.label.split(" #")[0].split(" · ").map(name).join(" · ") +
              (n.label.includes(" #") ? " #" + n.label.split(" #")[1] : "") +
              (n.kind === "machine"
                ? `\n负载 ${(n.load * 100).toFixed(1)}%`
                : ""),
            fill:
              n.kind === "terminal"
                ? "#4ecdc4"
                : n.kind === "machine"
                  ? "#fff"
                  : "#ffe66d",
          },
        };
      }),
      edges: d.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        data: e,
        style: {
          sourcePort: e.sourcePort,
          targetPort: e.targetPort,
          labelText: `${name(e.item)} ${Number(e.rate.toFixed(3))}${e.kind === "heat" ? " 热/秒" : " /分"}${priorityPorts.has(e.sourcePort) || priorityPorts.has(e.targetPort) ? " · 优先" : ""}`,
          lineDash: e.kind === "heat" ? [6, 6] : undefined,
          stroke: e.kind === "heat" ? "#ff6b6b" : "#000",
        },
      })),
    },
    node: {
      type: "rect",
      style: {
        radius: 0,
        lineWidth: 4,
        stroke: "#000",
        labelFill: "#000",
        labelFontSize: 16,
        labelFontWeight: 700,
        labelPlacement: "center",
        labelWordWrap: true,
        labelMaxWidth: "90%",
        labelMaxLines: 3,
        labelLineHeight: 22,
        shadowBlur: 0,
        shadowColor: "#4ecdc4",
        shadowOffsetX: 6,
        shadowOffsetY: 6,
      },
    },
    edge: {
      type: "polyline",
      style: {
        lineWidth: 2,
        endArrow: true,
        labelFontSize: 14,
        labelFill: "#000",
        labelBackground: true,
        labelBackgroundFill: "#fff",
        labelBackgroundStroke: "#000",
        labelPadding: 4,
      },
    },
    behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
    animation: false,
  });
  const renderedGraph = graph;
  await renderedGraph.render();
  if (currentGeneration !== generation) return;
  renderedGraph.on("node:click", (event) => {
    const n = d.nodes.find((n) => n.id === event.target.id);
    if (!n) return;
    const panel = $("detail-inspect");
    panel.classList.remove("hidden");
    panel.textContent = [
      n.label.split(" #")[0].split(" · ").map(name).join(" · ") +
        (n.label.includes(" #") ? " #" + n.label.split(" #")[1] : ""),
      ...n.ports.map(
        (p) =>
          `${p.dir === "in" ? "输入" : "输出"}${p.priority ? "（优先）" : ""} · ${name(p.item)} ${Number(p.rate.toFixed(5))} ${p.item === "热量" ? "热/秒" : "/分"}`,
      ),
    ].join("\n");
  });
  $("detail-fit").onclick = () => graph?.fitView();
  $("detail-zoom-in").onclick = () => graph?.zoomBy(1.5);
  $("detail-zoom-out").onclick = () => graph?.zoomBy(1 / 1.5);
}
