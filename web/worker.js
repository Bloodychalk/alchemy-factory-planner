import { recommend } from "./planning.js";
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
    self.postMessage({ id, type: "result", ...result });
  } catch (error) {
    self.postMessage({ id, type: "error", error: error.message });
  }
};
