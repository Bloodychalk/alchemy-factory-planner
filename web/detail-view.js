import { graphTheme as t, lineStyle } from "./graph-theme.js";
import { loadGraphAssets } from "./runtime.js";
import {
  prepareDetailLayout,
  expandDetailLayout,
  restoredPositions,
  DETAIL_LAYOUT_VERSION,
  isJunction,
  obstacleIndex,
  matrixRoutes,
} from "./detail-layout.js";
import {
  registerDetailElements,
  animateFlows,
  clearFlowShapes,
  stopFlowAnimations,
} from "./detail-elements.js";
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
const $ = (id) => document.getElementById(id);
let generation = 0,
  graph = null,
  key = "",
  timer = null,
  layoutEngine = null,
  topology;
let preferredLineStyle = "dash",
  active = false,
  occupied = () => false;
let rendered = false;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
reducedMotion.addEventListener("change", () => {
  if (graph && rendered) animateFlows(graph, active);
});
export function setDetailActive(value) {
  active = value;
  if (graph && rendered) animateFlows(graph, active);
}
export async function setDetailLineStyle(value) {
  preferredLineStyle = lineStyle(value);
  $("detail-edge-style").setAttribute(
    "aria-pressed",
    String(preferredLineStyle === "chevron"),
  );
  $("detail-edge-style").title =
    preferredLineStyle === "dash" ? "动态虚线" : "静态箭纹";
  if (!graph || !rendered) return;
  const current = graph;
  const selected = preferredLineStyle;
  const changed = current
    .getEdgeData()
    .filter((e) => e.style.flowStyle !== selected);
  if (!changed.length) return;
  stopFlowAnimations();
  for (let i = 0; i < changed.length; i += 100) {
    if (graph !== current || preferredLineStyle !== selected) return;
    current.updateEdgeData(
      changed
        .slice(i, i + 100)
        .map((e) => ({ id: e.id, style: { flowStyle: selected } })),
    );
    await current.draw();
    if (changed.length > 100)
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
  }
  if (graph === current) animateFlows(graph, active);
}
export function destroyDetail() {
  generation++;
  clearTimeout(timer);
  layoutEngine?.terminateWorker();
  layoutEngine = null;
  clearFlowShapes();
  graph?.destroy();
  graph = null;
  rendered = false;
  key = "";
  $("detail-inspect")?.classList.add("hidden");
}
function fingerprint(d) {
  let h = 2166136261;
  for (const c of JSON.stringify([d.nodes, d.edges]))
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return String(h >>> 0);
}
export function detailLayout() {
  return graph && rendered
    ? {
        layoutVersion: DETAIL_LAYOUT_VERSION,
        key: topology,
        positions: graph
          .getNodeData()
          .map((n) => ({ id: n.id, x: n.style.x, y: n.style.y })),
      }
    : null;
}
function bounds(nodes) {
  return nodes.map((n) => {
    const [w, h] = n.style.size;
    return {
      id: n.id,
      x1: n.style.x - w / 2 - 6,
      y1: n.style.y - h / 2 - 6,
      x2: n.style.x + w / 2 + 6,
      y2: n.style.y + h / 2 + 6,
    };
  });
}
function routeType(e, nodes, prepared) {
  const a = nodes.get(e.source),
    b = nodes.get(e.target);
  const p = prepared.specs
      .get(e.source)
      .ports.find((p) => p.id === e.sourcePort),
    q = prepared.specs.get(e.target).ports.find((p) => p.id === e.targetPort);
  const x1 = a.style.x + p.x,
    y1 = a.style.y + p.y,
    x2 = b.style.x + q.x,
    y2 = b.style.y + q.y;
  if (x2 <= x1) return "factory-routed-flow";
  for (let i = 1; i < 32; i++) {
    const v = i / 32,
      u = 1 - v,
      mid = (x1 + x2) / 2;
    const x =
      u ** 3 * x1 + 3 * u ** 2 * v * mid + 3 * u * v ** 2 * mid + v ** 3 * x2;
    const y =
      u ** 3 * y1 + 3 * u ** 2 * v * y1 + 3 * u * v ** 2 * y2 + v ** 3 * y2;
    if (
      occupied({ x1: x - 2, x2: x + 2, y1: y - 2, y2: y + 2 }, [
        e.source,
        e.target,
      ])
    )
      return "factory-routed-flow";
  }
  return "factory-flow";
}
export async function renderDetail(plan, tr = {}, saved = null, db = {}) {
  if (!plan) return;
  const d = plan.detail;
  for (const id of [
    "detail-fit",
    "detail-zoom-in",
    "detail-zoom-out",
    "detail-edge-style",
  ])
    $(id).disabled =
      d?.status !== "ready" || !rendered || key !== plan.createdAt;
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
  const [, images] = await Promise.all([
    loadLibraries(),
    loadGraphAssets(plan, db),
    document.fonts.ready,
  ]);
  if (
    loadingGeneration !== generation ||
    (key === plan.createdAt && (graph || layoutEngine))
  )
    return;
  destroyDetail();
  key = plan.createdAt;
  const currentGeneration = generation;
  registerDetailElements(window.G6, (...args) => occupied(...args));
  const name = (s) => tr.items?.[s] || tr.machines?.[s] || s;
  const label = (s) =>
    s.split(" #")[0].split(" · ").map(name).join(" · ") +
    (s.includes(" #") ? " #" + s.split(" #")[1] : "");
  $("detail-count").textContent =
    `${d.nodes.filter((n) => n.kind !== "terminal").length} 设备/构件 · ${d.edges.filter((e) => e.kind === "belt").length} 带段`;
  const prepared = prepareDetailLayout(d);
  const engine = new window.ELK({
    workerFactory: () =>
      new Worker(new URL("./vendor/elk-worker.min.js", import.meta.url)),
  });
  layoutEngine = engine;
  let timeout, layout;
  try {
    layout = await Promise.race([
      engine.layout(prepared.input),
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
  if (generation !== currentGeneration) return;
  const coords = expandDetailLayout(prepared, layout);
  topology = fingerprint(d);
  const previous = restoredPositions(saved, topology);
  for (const [id, p] of previous) {
    const c = coords.get(id);
    if (c) {
      c.rowTop += p.y - c.y;
      c.x = p.x;
      c.y = p.y;
    }
  }
  const corridors =
    d.nodes.length > 100 ? matrixRoutes(d, prepared, layout, coords) : null;
  const nodes = d.nodes.map((n) => {
    const c = coords.get(n.id),
      old = previous.get(n.id);
    const ports = c.ports.map((p) => ({
      ...p,
      name: name(p.item),
      icon: images.items[p.item],
      rateText: String(Number(p.rate.toFixed(3))),
    }));
    return {
      id: n.id,
      type: isJunction(n) ? "factory-junction" : "factory-card",
      data: { ...n },
      style: {
        x: old?.x ?? c.x,
        y: old?.y ?? c.y,
        size: [c.width, c.height],
        label: false,
        icon: false,
        fill: t.paper,
        stroke: t.ink,
        lineWidth: 4,
        radius: 0,
        shadowColor: t.mint,
        shadowBlur: 0,
        shadowOffsetX: 6,
        shadowOffsetY: 6,
        ports: ports.map((p) => ({
          key: p.id,
          placement: [p.x / c.width + 0.5, p.y / c.height + 0.5],
          r: 4,
          fill: p.priority ? t.coral : t.paper,
          stroke: t.ink,
          lineWidth: 2,
          linkToCenter: true,
        })),
        factory: {
          node: n,
          ports,
          title: name(n.machine || n.label.split(" · ")[0]),
          caption:
            n.kind === "filter"
              ? "过滤"
              : n.kind === "junction"
                ? "管道"
                : n.kind === "merger"
                  ? "合流"
                  : "分流",
          color:
            n.fertilizerDemand > 0
              ? t.mint
              : n.heatDemand > 0 || n.kind === "heater"
                ? t.coral
                : t.yellow,
          icon:
            images.machines[n.machine] ||
            (n.kind === "terminal" ? images.items[n.ports[0]?.item] : ""),
          footer:
            n.kind === "machine"
              ? `#${n.label.split(" #")[1]} · 负载 ${(n.load * 100).toFixed(1)}%`
              : n.kind === "terminal"
                ? label(n.label)
                : "1 台",
        },
      },
    };
  });
  occupied = obstacleIndex(bounds(nodes));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const priority = new Set(
    d.nodes.flatMap((n) => n.ports.filter((p) => p.priority).map((p) => p.id)),
  );
  const edges = d.edges.map((e) => {
    const icon = images.items[e.item];
    const value = `${Number(e.rate.toFixed(3))}${e.kind === "heat" ? " 热/秒" : "/分"}`;
    const usage =
      e.kind === "belt" ? ` (${(e.rate / e.capacity).toFixed(2)})` : "";
    const text = `${icon ? "" : name(e.item) + " "}${value}${usage}${priority.has(e.sourcePort) || priority.has(e.targetPort) ? " · 优先" : ""}`;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      data: e,
      type: corridors ? "factory-routed-flow" : routeType(e, nodeMap, prepared),
      style: {
        sourcePort: e.sourcePort,
        targetPort: e.targetPort,
        flowStyle: preferredLineStyle,
        stroke: e.kind === "heat" ? t.coral : t.ink,
        lineWidth: 2.5,
        endArrow: false,
        radius: 16,
        controlPoints: corridors?.get(e.id) || [],
        router: corridors
          ? false
          : {
              type: "shortest-path",
              enableObstacleAvoidance: true,
              offset: 20,
              gridSize: 24,
              maximumLoops: 600,
              startDirections: ["right"],
              endDirections: ["left"],
            },
        factory: {
          id: e.id,
          icon,
          label: text,
          labelWidth: Math.ceil(
            [...text].reduce(
              (v, c) => v + (c.charCodeAt(0) > 255 ? 11 : 6.5),
              icon ? 38 : 14,
            ),
          ),
        },
      },
    };
  });
  const large = nodes.length > 100;
  const current = new window.G6.Graph({
    container: $("detail-canvas"),
    height: 660,
    zoomRange: [0.0001, 10],
    autoResize: true,
    autoFit: large ? undefined : "view",
    padding: 24,
    data: large ? { nodes: [], edges: [] } : { nodes, edges },
    node: { type: (d) => d.type },
    edge: { type: (d) => d.type },
    behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
    animation: false,
  });
  graph = current;
  await current.render();
  if (large) {
    // Flush canvas mutation records between batches; a single huge frame exceeds
    // the renderer's argument-stack limit and prevents browser interaction.
    for (const [values, add] of [
      [nodes, (batch) => current.addNodeData(batch)],
      [edges, (batch) => current.addEdgeData(batch)],
    ]) {
      for (let i = 0; i < values.length; i += 100) {
        if (generation !== currentGeneration) return;
        const batch = values.slice(i, i + 100);
        if (values === edges)
          for (const e of batch) e.style.flowStyle = preferredLineStyle;
        add(batch);
        await current.draw();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      }
    }
    if (generation !== currentGeneration) return;
    await current.fitView();
  }
  if (generation !== currentGeneration) return;
  rendered = true;
  await setDetailLineStyle(preferredLineStyle);
  if (generation !== currentGeneration) return;
  for (const id of [
    "detail-fit",
    "detail-zoom-in",
    "detail-zoom-out",
    "detail-edge-style",
  ])
    $(id).disabled = false;
  animateFlows(graph, active);
  current.on("node:click", (event) => {
    const n = d.nodes.find((n) => n.id === event.target.id);
    if (!n) return;
    $("detail-inspect").classList.remove("hidden");
    $("detail-inspect").textContent = [
      label(n.label),
      ...n.ports.map(
        (p) =>
          `${p.dir === "in" ? "输入" : "输出"}${p.priority ? "（优先）" : ""} · ${name(p.item)} ${Number(p.rate.toFixed(5))} ${p.item === "热量" ? "热/秒" : "/分"}`,
      ),
    ].join("\n");
  });
  current.on("edge:click", (event) => {
    const e = d.edges.find((e) => e.id === event.target.id);
    if (!e) return;
    $("detail-inspect").classList.remove("hidden");
    $("detail-inspect").textContent =
      `${name(e.item)} · ${Number(e.rate.toFixed(5))} ${e.kind === "heat" ? "热/秒" : "/分"}`;
  });
  current.on("node:dragend", async (event) => {
    if (graph !== current) return;
    occupied = obstacleIndex(bounds(graph.getNodeData()));
    const map = new Map(graph.getNodeData().map((n) => [n.id, n]));
    let movedRoutes;
    if (corridors) {
      for (const [id, n] of map) {
        const c = coords.get(id);
        c.rowTop += n.style.y - c.y;
        c.x = n.style.x;
        c.y = n.style.y;
      }
      movedRoutes = matrixRoutes(d, prepared, layout, coords);
    }
    graph.updateEdgeData(
      d.edges
        .filter(
          (e) => e.source === event.target.id || e.target === event.target.id,
        )
        .map((e) => ({
          id: e.id,
          type: corridors ? "factory-routed-flow" : routeType(e, map, prepared),
          ...(movedRoutes
            ? { style: { controlPoints: movedRoutes.get(e.id) } }
            : {}),
        })),
    );
    await graph.draw();
    if (graph === current) animateFlows(graph, active);
  });
  $("detail-fit").onclick = () => graph?.fitView();
  $("detail-zoom-in").onclick = () => graph?.zoomBy(1.5);
  $("detail-zoom-out").onclick = () => graph?.zoomBy(1 / 1.5);
}
