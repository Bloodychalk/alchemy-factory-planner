import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import {
  readLiteral,
  validateDataset,
  perMinute,
  clone,
  canonicalizeDataset,
} from "../web/data.js";
import { recommend, describePlan } from "../web/planning.js";
import { patchSource } from "../web/patches.js";

const manifest = JSON.parse(
  fs.readFileSync(new URL("../web/upstream.json", import.meta.url)),
);
const local = new URL("../research/AlchemyFactoryCalculator/", import.meta.url);
const dataRoot =
  process.env.REFERENCE_ROOT ||
  (fs.existsSync(local)
    ? local
    : path.join(
        process.platform === "darwin"
          ? path.join(os.homedir(), "Library/Application Support")
          : process.platform === "win32"
            ? process.env.LOCALAPPDATA || ""
            : path.join(os.homedir(), ".local/share"),
        "AlchemyFactoryPlanner/reference",
        manifest.commit,
      ));
const read = (name) =>
  fs.readFileSync(
    dataRoot instanceof URL
      ? new URL(name, dataRoot)
      : path.join(dataRoot, name),
    "utf8",
  );
const db = readLiteral(read("js/alchemy_db.js"), "window.ALCHEMY_DB =");
db.settings = readLiteral(
  read("js/alchemy_state.js"),
  "const DEFAULT_SETTINGS =",
);
const context = vm.createContext({
  console: { log() {}, warn() {}, info() {} },
});
context.window = context;
Object.defineProperty(context, "DB", { get: () => globalThis.DB });
vm.runInContext(
  patchSource("alchemy_calc_engine.js", read("js/alchemy_calc_engine.js")),
  context,
);
const rules = read("js/alchemy_cauldron.js");
context.getCurrentItemName = (n) => n;
vm.runInContext(
  rules.slice(
    rules.indexOf("function getCauldronStats("),
    rules.indexOf("async function runCauldronSimulationType0("),
  ),
  context,
);
const helpers = {
  stats: context.getCauldronStats,
  targets: context._getCauldronValidTargets,
  resolve2: context.resolveCauldronOutput2,
  resolve3: context.resolveCauldronOutput3,
};
const preferredRecipes = {};
for (const recipe of db.recipes)
  for (const item of Object.keys(recipe.outputs))
    preferredRecipes[item] ??= recipe.id;
const base = {
  amount: 60,
  unit: "minute",
  fuel: "Coal",
  fertilizer: "Basic Fertilizer",
  cauldron: false,
  preferredRecipes,
};
const compute = (item, extra = {}, options = {}) =>
  recommend(
    db,
    context.AlchemyCalcEngine,
    { ...base, item, ...extra },
    { timeLimit: 100, ...options },
  );

test("pinned data and translations parse without executing JS", () => {
  const validated = validateDataset(db);
  assert.equal(Object.keys(validated.db.items).length, 157);
  assert.equal(validated.db.recipes.length, 222);
  const i18n = readLiteral(read("js/alchemy_i18n.js"), "window.ALCHEMY_I18N =");
  assert.equal(i18n.items["Steel Ingot"], "钢锭");
  assert.equal(
    readLiteral(
      'const X={"url":"https://example.test/a//b", L:3, note:"/* keep */", list:[1,2,],};',
      "const X=",
    ).url,
    "https://example.test/a//b",
  );
  assert.throws(() => readLiteral("const X={x:process.exit()};", "const X="));
});
test("three target units are equivalent and invalid rates fail", () => {
  assert.equal(perMinute(1, "second"), 60);
  assert.equal(perMinute(1, "interval"), 60);
  assert.equal(perMinute(2, "interval"), 30);
  for (const n of [0, -1, NaN, Infinity])
    assert.throws(() => perMinute(n, "minute"));
});
test("bad JSON schema never becomes a valid dataset", () => {
  const bad = clone(db);
  bad.recipes[0].inputs = { "Unknown Input": 1 };
  assert.throws(() => validateDataset(bad), /未知物品/);
  const bad2 = clone(db);
  bad2.recipes[0].outputs[Object.keys(bad2.recipes[0].outputs)[0]] = 0;
  assert.throws(() => validateDataset(bad2), /数量/);
  assert.equal(db.recipes.length, 222);
});
test("plank 60/min: two saws, .3 logs/min, same graph totals", async () => {
  const { plan } = await compute("Plank");
  assert.equal(plan.purchases.Logs, 0.3);
  assert.equal(plan.machines["Table Saw"], 2);
  assert.equal(plan.cost, 60);
  assert.ok(plan.audit.material);
  assert.equal(plan.steps.length, 1);
  assert.match(describePlan(plan), /60/);
  const saw = Object.values(plan.graph.nodes).find(
    (n) => n.recipeId === "Plank",
  );
  assert.equal(saw.machineCount, 2);
  assert.equal(saw.resolved.outputsPerMachine[0].rate * saw.machineCount, 60);
});
test("iron smelting includes self-produced fuel and heat balance", async () => {
  const { plan } = await compute("Iron Ingot", { amount: 10 });
  assert.equal(plan.heat, 9);
  assert.equal(plan.fuelRate, 1);
  assert.ok(Math.abs(plan.purchases["Coal Ore"] - 1 / 120) < 1e-8);
  assert.equal(plan.purchases["Iron Ore"], 0.1);
  assert.equal(plan.audit.heat, true);
});
test("steel recycling reduces fresh iron ore by 75 percent", async () => {
  const a = (await compute("Steel Ingot", { recycle: false })).plan;
  const b = (await compute("Steel Ingot", { recycle: true })).plan;
  assert.equal(a.purchases["Iron Ore"], 2.4);
  assert.equal(b.purchases["Iron Ore"], 0.6);
  assert.ok(b.heat < a.heat);
  assert.ok(Object.values(b.audit.balance).every((v) => v >= -1e-4));
});
test("fertilizer supply and nutrition audit", async () => {
  const { plan } = await compute("Healing Potion", { amount: 10 });
  assert.ok(plan.fertilizerRate > 0);
  assert.ok(plan.audit.nutrients);
  assert.ok(plan.steps.some((s) => s.outputs["Basic Fertilizer"]));
});
test("a fuel target is a net delivery after own burning", async () => {
  const { plan } = await compute("Coke", { amount: 10, fuel: "Coke" });
  assert.ok(plan.fuelRate > 0);
  assert.ok(
    plan.steps.reduce(
      (n, s) => n + (s.outputs.Coke || 0) - (s.inputs.Coke || 0),
      0,
    ) >=
      10 + plan.fuelRate - 1e-3,
  );
  assert.equal(plan.desired, 10);
});
test("same product can supply both fuel and fertilizer without double credit", async () => {
  try {
    const { plan } = await compute(
      "Healing Potion",
      { amount: 1, fuel: "Panacea Potion", fertilizer: "Panacea Potion" },
      { timeLimit: 200 },
    );
    assert.ok(plan.audit.heat && plan.audit.nutrients);
  } catch (e) {
    assert.match(e.message, /没有找到|平衡|未收敛/);
  }
});
test("unavailable circular supply is rejected instead of marked free", async () => {
  const cyclic = clone(db);
  cyclic.recipes = cyclic.recipes.filter((r) => !r.outputs.Plank);
  cyclic.recipes.push({
    id: "Loop",
    machine: "Table Saw",
    inputs: { Plank: 1 },
    outputs: { Plank: 1 },
    baseTime: 2,
  });
  await assert.rejects(
    () =>
      recommend(
        cyclic,
        context.AlchemyCalcEngine,
        { ...base, item: "Plank", preferredRecipes: {} },
        { timeLimit: 80 },
      ),
    /没有找到/,
  );
});
test("bounded recommendation compares candidates without claiming global optimality", async () => {
  const { plan } = await compute(
    "Steel Ingot",
    { amount: 10, preferredRecipes: {}, cauldron: true },
    { helpers, timeLimit: 800 },
  );
  assert.ok(plan.search.evaluated > 1);
  assert.equal(plan.search.globalOptimum, false);
  assert.ok(plan.audit.material);
  assert.ok(plan.steps.every((s) => Number.isInteger(s.installed)));
});
test("reopening a plan keeps generated recipe IDs unique and exportable", async () => {
  const request = { ...base, item: "Plank", cauldron: true };
  let saved = db;
  for (let round = 0; round < 3; round++) {
    const result = await recommend(saved, context.AlchemyCalcEngine, request, {
      helpers,
      timeLimit: 100,
    });
    saved = JSON.parse(JSON.stringify(result.db));
    assert.ok(saved.recipes.some((r) => r.id.startsWith("AFP_CAULDRON_")));
    assert.equal(
      new Set(saved.recipes.map((r) => r.id)).size,
      saved.recipes.length,
    );
    assert.doesNotThrow(() => validateDataset(saved));
    assert.equal(result.plan.desired, 60);
    assert.ok(result.plan.audit.material);
  }
});
test("research thresholds and canonical names are preserved", () => {
  assert.equal(context.AlchemyCalcEngine.getSpeedMult(12), 4);
  assert.equal(context.AlchemyCalcEngine.getSpeedMult(13), 4.05);
  assert.equal(context.AlchemyCalcEngine.getBeltSpeed(12), 240);
  assert.equal(context.AlchemyCalcEngine.getBeltSpeed(13), 243);
  assert.ok(db.items["Steel Ingot"]);
  assert.ok(!db.items["钢锭"]);
});
test("Chinese legacy datasets map back to canonical English without rewriting IDs", () => {
  const original = clone(db);
  original.items["钢锭"] = original.items["Steel Ingot"];
  delete original.items["Steel Ingot"];
  for (const r of original.recipes)
    for (const side of ["inputs", "outputs"])
      if (r[side]["Steel Ingot"]) {
        r[side]["钢锭"] = r[side]["Steel Ingot"];
        delete r[side]["Steel Ingot"];
      }
  const fixed = canonicalizeDataset(original, {
    items: { "Steel Ingot": "钢锭" },
  });
  assert.ok(validateDataset(fixed));
  assert.ok(fixed.items["Steel Ingot"]);
  assert.ok(!fixed.items["钢锭"]);
  assert.equal(fixed.recipes.length, db.recipes.length);
});
test("a non-heated custom JSON does not require fictitious fuel or fertilizer items", async () => {
  const custom = {
    items: { Raw: { buyPrice: 2 }, Product: {} },
    machines: { Press: {} },
    recipes: [
      {
        id: "PressProduct",
        machine: "Press",
        inputs: { Raw: 2 },
        outputs: { Product: 1 },
        baseTime: 2,
      },
    ],
  };
  const { plan } = await recommend(
    custom,
    context.AlchemyCalcEngine,
    { item: "Product", amount: 30, unit: "minute", cauldron: false },
    { timeLimit: 100 },
  );
  assert.equal(plan.cost, 120);
  assert.equal(plan.heat, 0);
});
test("an explicit zero purchase price is free, while a missing price is not", async () => {
  const custom = {
    items: { Raw: { buyPrice: 0 }, Product: {} },
    machines: { Press: {} },
    recipes: [
      {
        id: "PressProduct",
        machine: "Press",
        inputs: { Raw: 2 },
        outputs: { Product: 1 },
        baseTime: 2,
      },
    ],
  };
  const { plan } = await recommend(
    custom,
    context.AlchemyCalcEngine,
    { item: "Product", amount: 30, unit: "minute", cauldron: false },
    { timeLimit: 100 },
  );
  assert.equal(plan.cost, 0);
  delete custom.items.Raw.buyPrice;
  await assert.rejects(() =>
    recommend(
      custom,
      context.AlchemyCalcEngine,
      { item: "Product", amount: 30, unit: "minute", cauldron: false },
      { timeLimit: 50 },
    ),
  );
});
test("runtime editor fixes prevent the original import fall-through", () => {
  const store = new Map();
  const input = JSON.stringify({
    items: { Example: {} },
    machines: { Press: {} },
    recipes: [],
  });
  const c = vm.createContext({
    document: {
      getElementById: (id) => ({
        value: id === "editor-target" ? "db" : input,
      }),
    },
    referenceStorage: {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, v),
    },
    init() {},
    translateDatabase() {},
    location: { reload() {} },
    alert() {},
  });
  c.window = c;
  vm.runInContext(
    patchSource("alchemy_state.js", read("js/alchemy_state.js")),
    c,
  );
  vm.runInContext("applyChanges()", c);
  assert.equal(c.ALCHEMY_I18N, undefined);
  assert.equal(vm.runInContext("DB.settings", c), undefined);
});
test("custom paradox inputs and catalyst modifiers use the reference rules", async () => {
  const recipe = db.recipes.find((r) => r.id === "Coke Advanced Athanor");
  globalThis.DB = db;
  const state = {
    preferredRecipes: { Coke: recipe.id },
    recipeModifiers: { [recipe.id]: { catalysts: ["fertile"] } },
  };
  const modified = context.AlchemyCalcEngine.getActiveRecipe(db, state, "Coke");
  assert.equal(modified.outputs.Coke, recipe.outputs.Coke * 2);
  assert.ok(modified.inputs["Fertile Catalyst"] > 0);
  const { plan } = await compute("Oblivion Essence", {
    amount: 1,
    recipeId: "Oblivion Essence (Custom)",
    modifiers: { "Oblivion Essence (Custom)": { customInput: "Limestone" } },
  });
  assert.ok(
    plan.steps.some((s) => s.recipe.customInputSlot && s.inputs.Limestone > 0),
  );
});
