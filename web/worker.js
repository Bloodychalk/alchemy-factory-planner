import { buildDetailedPlan } from "./logistics.js";
import { buildGraph, recommend } from "./planning.js";
let engine, helpers;
self.onmessage = async (event) => {
  const { id, type, ...payload } = event.data;
  try {
    if (type === "init") {
      globalThis.window = globalThis;
      globalThis.getCurrentItemName = (name) => name;
      console.log = () => {};
      console.info = () => {};
      console.warn = () => {};
      const url = URL.createObjectURL(
        new Blob(
          [
            payload.engine +
              "\n" +
              payload.rules +
              "\nglobalThis.cauldronHelpers={stats:getCauldronStats,targets:_getCauldronValidTargets,resolve2:resolveCauldronOutput2,resolve3:resolveCauldronOutput3};",
          ],
          { type: "text/javascript" },
        ),
      );
      // Modules cannot importScripts; import the verified pinned engine as a temporary module.
      await import(url);
      URL.revokeObjectURL(url);
      engine = globalThis.AlchemyCalcEngine;
      helpers = globalThis.cauldronHelpers;
      self.postMessage({ id, type: "ready" });
      return;
    }
    if (!engine) throw new Error("计算引擎尚未准备完成");
    const result = await recommend(payload.db, engine, payload.request, {
      helpers,
      onProgress: (p) => self.postMessage({ id, type: "progress", ...p }),
    });
    const rules = await fetch(
      new URL("./logistics-rules.json", import.meta.url),
    )
      .then((r) => r.json())
      .catch(() => ({ version: 1, machines: {} }));
    const detail = buildDetailedPlan(result.plan, result.db, rules);
    if (detail.status === "ready") {
      const p = result.plan;
      p.machines = {};
      for (const g of detail.groups) {
        if (g.s.recipe.buildCost)
          p.startup[g.s.recipe.buildCost] =
            (p.startup[g.s.recipe.buildCost] || 0) + g.count - g.s.installed;
        g.s.installed = g.count;
        g.s.utilization = g.s.machines / g.count;
        p.machines[g.s.machine] = (p.machines[g.s.machine] || 0) + g.count;
      }
      p.heaterCount = detail.nodes.filter((n) => n.kind === "heater").length;
      p.installed =
        Object.values(p.machines).reduce((a, b) => a + b, 0) + p.heaterCount;
      p.logisticsMachines = {};
      for (const n of detail.nodes.filter((n) =>
        ["purchase", "bank"].includes(n.kind),
      ))
        p.logisticsMachines[n.machine] =
          (p.logisticsMachines[n.machine] || 0) + 1;
      p.constructionCosts = {};
      for (const [name, count] of Object.entries({
        ...p.machines,
        ...p.logisticsMachines,
        [p.settings.selectedHeatingDevice]: p.heaterCount,
      }))
        for (const [item, qty] of Object.entries(
          result.db.machines[name]?.buildCost || {},
        ))
          p.constructionCosts[item] =
            (p.constructionCosts[item] || 0) + qty * count;
      p.installedHeat = p.steps.reduce(
        (sum, s) => sum + (s.heat / (s.machines || 1)) * s.installed,
        0,
      );
      p.graph = buildGraph(p);
      delete detail.groups;
    }
    result.plan.detail = detail;
    self.postMessage({ id, type: "result", ...result });
  } catch (error) {
    self.postMessage({ id, type: "error", error: error.message });
  }
};
