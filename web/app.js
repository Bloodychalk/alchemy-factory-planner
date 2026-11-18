import { perMinute, validateDataset, canonicalizeDataset } from "./data.js";
import { storage, saveFile, desktopAPI } from "./platform.js";
import { loadReference, graphDocument } from "./runtime.js";
import { describePlan } from "./planning.js";
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n.toFixed(4)).toLocaleString("zh-CN");
let reference,
  db,
  plan = null,
  planDb,
  worker = null,
  requestId = 0,
  workerReady = false,
  mode = "text",
  graphKey = "",
  busy = false,
  pendingLayout = null;
const tr = (k) =>
  reference?.translations.items?.[k] ||
  reference?.translations.machines?.[k] ||
  k;
const showMessage = (text, error = false) => {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
};
const esc = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function updateItems(filter = "") {
  const selected = $("target-item").value,
    f = filter.toLowerCase();
  const entries = Object.keys(db.items)
    .filter(
      (k) =>
        (!db.items[k].virtual || db.items[k].category === "Liquid") &&
        (k + " " + tr(k)).toLowerCase().includes(f),
    )
    .sort((a, b) => tr(a).localeCompare(tr(b), "zh-CN"));
  $("target-item").replaceChildren(
    ...entries.map((k) => new Option(tr(k) + " · " + k, k)),
  );
  if (entries.includes(selected)) $("target-item").value = selected;
  if (!$("target-item").value && entries.length)
    $("target-item").value = entries[0];
  updateRecipes();
}
function updateRecipes() {
  const selected = $("recipe").value,
    recipes = db.recipes.filter((r) => r.outputs[$("target-item").value]);
  $("recipe").replaceChildren(
    new Option("自动推荐", ""),
    ...recipes.map((r) => new Option(`${tr(r.machine)} · ${r.id}`, r.id)),
  );
  if (recipes.some((r) => r.id === selected)) $("recipe").value = selected;
  updateModifiers();
}
function updateModifiers() {
  const recipe = db.recipes.find((r) => r.id === $("recipe").value);
  $("catalysts").classList.toggle(
    "hidden",
    recipe?.machine !== "Advanced Athanor",
  );
  $("custom-input-row").classList.toggle("hidden", !recipe?.customInputSlot);
  if (recipe?.customInputSlot) {
    const selected = $("custom-input").value;
    $("custom-input").replaceChildren(
      ...Object.keys(db.items)
        .filter(
          (k) =>
            db.items[k].baseCost > 0 &&
            (!db.items[k].virtual || db.items[k].category === "Liquid") &&
            !db.items[k].liquid,
        )
        .map((k) => new Option(tr(k), k)),
    );
    if (db.items[selected]) $("custom-input").value = selected;
  }
}
function modifiers() {
  const recipe = db.recipes.find((r) => r.id === $("recipe").value);
  if (recipe?.machine === "Advanced Athanor")
    return {
      [recipe.id]: {
        catalysts: ["unstable", "fertile", "resonant", "eternal"].filter(
          (k) => $("catalyst-" + k).checked,
        ),
      },
    };
  if (recipe?.customInputSlot)
    return { [recipe.id]: { customInput: $("custom-input").value } };
  return {};
}
function updateDataset() {
  updateItems();
  for (const [id, test] of [
    ["fuel", (d) => d.heat > 0],
    ["fertilizer", (d) => d.nutrientValue > 0],
  ])
    $(id).replaceChildren(
      new Option("自动推荐", ""),
      ...Object.keys(db.items)
        .filter((k) => test(db.items[k]))
        .map((k) => new Option(tr(k), k)),
    );
  $("heater").replaceChildren(
    ...Object.entries(db.machines)
      .filter(([, v]) => v.isGenerator)
      .map(([k]) => new Option(tr(k), k)),
  );
  if (db.machines["Stone Furnace"]) $("heater").value = "Stone Furnace";
  $("data-count").textContent =
    `${Object.keys(db.items).length} 物品 · ${db.recipes.length} 配方`;
  $("data-source").textContent =
    `游戏 ${db.gameVersion || "自定义"} · 数据 v${db.version || 1} · ${db.metadata?.wikiSyncedAt ? "已按 Wiki 校准" : "参考计算器资料"}`;
  for (const id of ["item-search", "target-item", "calculate", "export-data"])
    $(id).disabled = false;
}
function gather() {
  return {
    item: $("target-item").value,
    amount: Number($("amount").value),
    unit: $("unit").value,
    fuel: $("fuel").value,
    fertilizer: $("fertilizer").value,
    recipeId: $("recipe").value,
    recycle: $("recycle").checked,
    cauldron: $("cauldron").checked,
    selfSupply: true,
    modifiers: modifiers(),
    heater: $("heater").value,
    height: Number($("height").value),
    levels: Object.fromEntries(
      ["factory", "logistics", "alchemy", "fuel", "fertilizer"].map((k) => [
        k,
        Number($("level-" + k).value),
      ]),
    ),
  };
}
function restoreRequest(request) {
  $("item-search").value = "";
  updateItems();
  $("target-item").value = request.item;
  updateRecipes();
  for (const key of [
    "amount",
    "unit",
    "fuel",
    "fertilizer",
    "heater",
    "height",
  ])
    if (request[key] != null) $(key).value = request[key];
  if (request.recipeId) $("recipe").value = request.recipeId;
  updateModifiers();
  const modifier = request.modifiers?.[request.recipeId];
  for (const key of ["unstable", "fertile", "resonant", "eternal"])
    $("catalyst-" + key).checked = modifier?.catalysts?.includes(key) || false;
  if (modifier?.customInput) $("custom-input").value = modifier.customInput;
  for (const [k, v] of Object.entries(request.levels || {}))
    if ($("level-" + k)) $("level-" + k).value = v;
  $("recycle").checked = request.recycle !== false;
  $("cauldron").checked = request.cauldron !== false;
  updateHint();
}
function updateHint() {
  try {
    $("rate-hint").textContent =
      fmt(perMinute($("amount").value, $("unit").value)) + " 个 / 分钟";
  } catch (e) {
    $("rate-hint").textContent = e.message;
  }
}
function setBusy(value) {
  busy = value;
  for (const el of $("target-form").querySelectorAll("input,select"))
    el.disabled = value;
  for (const id of ["import-data", "load-plan", "sync-wiki"])
    $(id).disabled = value;
  $("calculate").disabled = value;
  $("calculate").firstChild.textContent = value
    ? "正在比较路线…"
    : "计算推荐产线 ";
  $("cancel").classList.toggle("hidden", !value);
}
async function newWorker() {
  worker?.terminate();
  worker = new Worker(new URL("./worker.js", import.meta.url), {
    type: "module",
  });
  workerReady = false;
  worker.onerror = (e) => {
    setBusy(false);
    showMessage("计算线程启动失败：" + e.message, true);
  };
  worker.onmessage = async ({ data }) => {
    if (data.type === "ready") {
      workerReady = true;
      return;
    }
    if (data.id !== requestId) return;
    if (data.type === "progress") {
      showMessage(`正在比较配方、燃料与肥料：已评估 ${data.evaluated} 个候选…`);
      return;
    }
    setBusy(false);
    if (data.type === "error") {
      showMessage(data.error, true);
      return;
    }
    plan = data.plan;
    planDb = data.db;
    if (pendingLayout) {
      for (const [id, node] of Object.entries(plan.graph.nodes)) {
        const old = pendingLayout.nodes?.[id];
        if (
          old?.recipeId === node.recipeId &&
          Number.isFinite(old.x) &&
          Number.isFinite(old.y) &&
          Math.abs(old.x) < 1e6 &&
          Math.abs(old.y) < 1e6
        ) {
          node.x = old.x;
          node.y = old.y;
          plan.layoutSaved = true;
        }
      }
      pendingLayout = null;
    }
    graphKey = "";
    renderPlan();
    storage.set("request", plan.request);
    storage.set("last-plan", { plan, db: planDb });
    const api = await desktopAPI();
    if (api) api.autosave(JSON.stringify({ plan, db: planDb })).catch(() => {});
  };
  worker.postMessage({
    type: "init",
    engine: reference.engine,
    rules: reference.rules,
  });
  await new Promise((resolve, reject) => {
    let count = 0;
    const timer = setInterval(() => {
      if (workerReady) {
        clearInterval(timer);
        resolve();
      } else if (++count > 150) {
        clearInterval(timer);
        reject(new Error("计算线程初始化超时"));
      }
    }, 100);
  });
}
async function calculate(event) {
  event?.preventDefault();
  if (busy) return;
  try {
    const request = gather();
    perMinute(request.amount, request.unit);
    setBusy(true);
    showMessage("正在比较可行生产路线…");
    if (!workerReady) await newWorker();
    requestId++;
    worker.postMessage({ id: requestId, type: "calculate", db, request });
  } catch (e) {
    setBusy(false);
    showMessage(e.message, true);
  }
}
function renderPlan() {
  $("empty").classList.add("hidden");
  $("output").classList.remove("hidden");
  $("result-title").textContent = tr(plan.request.item) + "的推荐产线";
  $("metric-output").textContent = fmt(plan.desired);
  $("metric-cost").textContent = fmt(plan.cost);
  $("metric-machines").textContent = plan.installed;
  $("metric-heat").textContent = fmt(plan.heat);
  $("purchases").replaceChildren(
    ...Object.entries(plan.purchases)
      .filter(([, v]) => v > 1e-6)
      .map(([k, v]) => {
        const e = document.createElement("div");
        e.className = "purchase";
        e.innerHTML = `<b>${esc(tr(k))}</b><span>${fmt(v)} /分</span>`;
        return e;
      }),
  );
  $("steps").replaceChildren(
    ...plan.steps.map((s) => {
      const r = document.createElement("tr");
      r.innerHTML = `<td><strong>${esc(tr(s.machine))}</strong><small>${esc(s.id)}</small></td><td>${s.installed}<small>理论 ${fmt(s.machines)}</small></td><td><span class="bar"><i style="width:${Math.min(100, s.utilization * 100)}%"></i></span>${fmt(s.utilization * 100)}%</td><td>${Object.entries(
        s.outputs,
      )
        .map(([k, v]) => `${esc(tr(k))} ${fmt(v)}`)
        .join("<br>")}</td>`;
      return r;
    }),
  );
  $("report").textContent = describePlan(plan, reference.translations);
  $("audit").textContent =
    `✓ 已复核物料、热量与营养平衡 · 比较 ${plan.search.evaluated} 个候选 · ${plan.search.timedOut ? "达到搜索时限" : "有界搜索完成"} · 概率产出采用长期平均值，需缓冲库存`;
  $("save-plan").disabled = false;
  showMessage("产线已生成。简介和图形使用同一份配平结果。");
  if (mode === "graph") renderGraph();
}
async function renderGraph() {
  if (!plan || graphKey === plan.createdAt) return;
  const key = plan.createdAt;
  showMessage("正在准备现有节点画布…");
  try {
    const html = await graphDocument({ plan, db: planDb }, showMessage);
    if (plan.createdAt !== key) return;
    $("graph").srcdoc = html;
    graphKey = key;
  } catch (e) {
    showMessage(
      "图形资源准备失败：" + e.message + "。简介结果仍可使用。",
      true,
    );
  }
}
function switchMode(value) {
  mode = value;
  $("text-view").classList.toggle("hidden", value !== "text");
  $("graph-view").classList.toggle("hidden", value !== "graph");
  $("tab-text").setAttribute("aria-selected", String(value === "text"));
  $("tab-graph").setAttribute("aria-selected", String(value === "graph"));
  if (value === "graph") renderGraph();
}
let fileMode = "data";
function pickFile(mode) {
  fileMode = mode;
  $("file-input").value = "";
  $("file-input").click();
}
$("file-input").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 20_000_000) throw new Error("文件超过 20 MB");
    const parsed = JSON.parse(await file.text());
    if (fileMode === "plan") {
      if (parsed.schemaVersion !== 1 || !parsed.plan?.request || !parsed.db)
        throw new Error("不是有效的产线方案文件");
      const next = validateDataset(
        canonicalizeDataset(parsed.db, reference.translations),
      ).db;
      perMinute(parsed.plan.request.amount, parsed.plan.request.unit);
      if (!next.items[parsed.plan.request.item])
        throw new Error("方案目标物品不存在");
      db = next;
      pendingLayout = parsed.plan.graph;
      updateDataset();
      restoreRequest(parsed.plan.request);
      showMessage("方案参数已载入，正在重新复核…");
      await calculate();
    } else {
      const checked = validateDataset(
        canonicalizeDataset(parsed, reference.translations),
      );
      db = checked.db;
      storage.set("dataset", db);
      desktopAPI().then((api) => api?.save_dataset(JSON.stringify(db)));
      plan = null;
      updateDataset();
      $("output").classList.add("hidden");
      $("empty").classList.remove("hidden");
      $("save-plan").disabled = true;
      showMessage(
        `资料导入成功。${checked.warnings.length ? checked.warnings.length + " 项规则待核验。" : ""}`,
      );
    }
  } catch (e) {
    showMessage("文件未导入，原资料保持不变：" + e.message, true);
  }
});
$("recipe").addEventListener("change", updateModifiers);
$("target-form").addEventListener("submit", calculate);
$("item-search").addEventListener("input", () =>
  updateItems($("item-search").value),
);
$("target-item").addEventListener("change", () => {
  updateRecipes();
  markStale();
});
for (const id of ["amount", "unit"])
  $(id).addEventListener("input", updateHint);
function markStale() {
  if (plan) showMessage("生产参数已变化，点击计算以更新结果。");
}
$("target-form").addEventListener("change", markStale);
$("cancel").onclick = () => {
  requestId++;
  worker?.terminate();
  workerReady = false;
  setBusy(false);
  showMessage("计算已取消，已有方案保留。");
};
$("tab-text").onclick = () => switchMode("text");
$("tab-graph").onclick = () => switchMode("graph");
$("import-data").onclick = () => pickFile("data");
$("load-plan").onclick = () => pickFile("plan");
$("export-data").onclick = () =>
  saveFile("alchemy-recipes.json", JSON.stringify(db, null, 2)).catch((e) =>
    showMessage(e.message, true),
  );
$("save-plan").onclick = async () => {
  if (mode === "graph" && graphKey) {
    $("graph").contentWindow.postMessage({ type: "export-layout" }, "*");
    await new Promise((r) => setTimeout(r, 100));
  }
  return saveFile(
    "alchemy-plan.json",
    JSON.stringify({ schemaVersion: 1, plan, db: planDb }, null, 2),
  ).catch((e) => showMessage(e.message, true));
};
$("export-text").onclick = () =>
  saveFile("alchemy-plan.txt", $("report").textContent, "text/plain").catch(
    (e) => showMessage(e.message, true),
  );
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("report").textContent);
    showMessage("简介已复制。");
  } catch {
    showMessage("浏览器未允许剪贴板，请使用导出文字。");
  }
};
$("sync-wiki").onclick = async () => {
  const api = await desktopAPI();
  if (!api) return;
  showMessage("正在读取 Wiki 并校准重叠配方…");
  $("sync-wiki").disabled = true;
  try {
    const result = await api.sync_wiki(JSON.stringify(db));
    if (!result.ok) throw new Error(result.error);
    db = validateDataset(JSON.parse(result.data)).db;
    storage.set("dataset", db);
    updateDataset();
    showMessage(
      `Wiki 校准完成：更新 ${result.updated} 条配方，保留特殊设备变体。${result.warnings.length ? "详情已写入资料来源记录。" : ""}`,
    );
  } catch (e) {
    showMessage("同步失败，旧资料保持不变：" + e.message, true);
  } finally {
    $("sync-wiki").disabled = false;
  }
};
window.addEventListener("message", (event) => {
  if (event.source !== $("graph").contentWindow) return;
  if (event.data?.type === "layout" && plan) {
    for (const [id, node] of Object.entries(plan.graph.nodes)) {
      const incoming = event.data.graph?.nodes?.[id];
      if (
        incoming &&
        Number.isFinite(incoming.x) &&
        Number.isFinite(incoming.y) &&
        Math.abs(incoming.x) < 1e6 &&
        Math.abs(incoming.y) < 1e6
      ) {
        node.x = incoming.x;
        node.y = incoming.y;
        plan.layoutSaved = true;
      }
    }
  }
  if (event.data?.type === "graph-ready")
    showMessage("图形已生成。可拖动节点、缩放和查看物料流量。");
});
try {
  reference = await loadReference();
  db = reference.db;
  const api = await desktopAPI();
  const saved = api ? await api.load_dataset() : null;
  const stored = saved?.data ? JSON.parse(saved.data) : storage.get("dataset");
  if (stored) {
    try {
      db = validateDataset(
        canonicalizeDataset(stored, reference.translations),
      ).db;
    } catch {
      showMessage("旧资料校验失败，已使用参考资料。");
    }
  }
  if (api && !stored) {
    showMessage("首次使用：正在按 Wiki 校准配方…");
    const synced = await api.sync_wiki(JSON.stringify(db));
    if (synced.ok) db = validateDataset(JSON.parse(synced.data)).db;
  }
  updateDataset();
  const remembered = storage.get("request");
  if (remembered && db.items[remembered.item]) restoreRequest(remembered);
  else {
    $("target-item").value = db.items["Steel Ingot"]
      ? "Steel Ingot"
      : Object.keys(db.items)[0];
    updateRecipes();
  }
  $("connection").textContent = "资料已就绪";
  showMessage(
    "资料已就绪。选择目标并计算，得到包含燃料和肥料自产链的推荐方案。",
  );
  if (api) {
    $("sync-wiki").classList.remove("hidden");
    const restored = await api.restore();
    if (restored.ok && restored.data && !remembered) {
      try {
        restoreRequest(JSON.parse(restored.data).plan.request);
      } catch {}
    }
  }
  if ("serviceWorker" in navigator && !api)
    navigator.serviceWorker
      .register(new URL("./sw.js", import.meta.url))
      .catch(() => {});
} catch (e) {
  $("connection").textContent = "资料未就绪";
  showMessage(
    "准备资料失败：" + e.message + "。请联网后刷新，或在桌面版重试。",
    true,
  );
}
