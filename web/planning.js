import { clone, perMinute, validateDataset } from "./data.js";
const EPS = 1e-5;
const add = (o, k, n) => {
  o[k] = (o[k] || 0) + n;
};
const ceil = (n) => Math.ceil(n - 1e-7);
const visit = (result, fn) => {
  const walk = (n) => {
    fn(n);
    n.children.forEach(walk);
  };
  result.treeRoots.forEach((r) => walk(r.root));
};
const keyOf = (recipe) =>
  recipe.id +
  "|" +
  JSON.stringify([
    recipe.inputs,
    recipe.outputs,
    recipe.baseTime,
    recipe.heatCost,
  ]);
export function createParameters(engine, request, fuel, fertilizer) {
  const levels = request.levels || {};
  for (const [name, value] of Object.entries(levels))
    if (!Number.isInteger(value) || value < 0 || value > 100)
      throw new Error(`${name} 等级必须是 0–100 的整数`);
  const rate = perMinute(request.amount, request.unit);
  return {
    targetItem: request.item,
    targetRate: rate,
    targets: [{ item: request.item, rate }],
    isMulti: false,
    selectedFuel: fuel,
    selectedFert: fertilizer,
    selectedHeatingDevice: request.heater || "Stone Furnace",
    selfFuel: request.selfSupply !== false,
    selfFert: request.selfSupply !== false,
    fuelMult: 1 + (levels.fuel || 0) * 0.1,
    fertMult: 1 + (levels.fertilizer || 0) * 0.1,
    speedMult: engine.getSpeedMult(levels.factory || 0),
    alchemyMult: engine.getAlchemyMult(levels.alchemy || 0),
    beltSpeed: engine.getBeltSpeed(levels.logistics || 0),
    sellMult: 1,
    wholesaleMult: 1,
    showFuelFert: true,
    showBeltCount: true,
    showRawMachineCount: true,
    showMaxCap: false,
    showHeatFert: true,
    showFuelCost: false,
    showFertCost: false,
    fuelCost: 0,
    fertCost: 0,
    lvlSpeed: levels.factory || 0,
    lvlAlchemy: levels.alchemy || 0,
    lvlBelt: levels.logistics || 0,
    lvlFuel: levels.fuel || 0,
    lvlFert: levels.fertilizer || 0,
  };
}

function obtainableItems(db, customCosts = {}) {
  const available = new Set(
    Object.keys(db.items).filter((k) =>
      Number.isFinite(customCosts[k] ?? db.items[k].buyPrice),
    ),
  );
  for (let pass = 0; pass < Object.keys(db.items).length; pass++) {
    const before = available.size;
    const heat = [...available].some((k) => db.items[k].heat > 0);
    const nutrients = [...available].some((k) => db.items[k].nutrientValue > 0);
    for (const r of db.recipes) {
      if (r.customInputSlot || r.verification === "unverified") continue;
      if (!Object.keys(r.inputs).every((k) => available.has(k))) continue;
      if ((r.heatCost > 0 || db.machines[r.machine]?.heatCost > 0) && !heat)
        continue;
      if (r.nutrientCost > 0 && !nutrients) continue;
      for (const k of Object.keys(r.outputs)) available.add(k);
    }
    if (available.size === before) break;
  }
  return available;
}

function evaluate(db, engine, request, choice, obtainable) {
  globalThis.DB = db;
  const params = createParameters(
    engine,
    request,
    choice.fuel,
    choice.fertilizer,
  );
  const desired = params.targetRate;
  const state = {
    preferredRecipes: choice.preferred,
    recipeModifiers: choice.modifiers || {},
    nodeRecipeOverrides: {},
    customCosts: request.customCosts || {},
    activeRecyclers: new Set(),
    forcedExternals: new Set(),
    expandCatalystInputs: {
      unstable: true,
      fertile: true,
      resonant: true,
      eternal: true,
    },
  };
  let result;
  let converged = false;
  for (let netIteration = 0; netIteration < 40; netIteration++) {
    result = engine.runCalculation({ db, params, state });
    if (request.recycle !== false) {
      // Every pass includes internal fuel/fertilizer trees. Never silently lose a new path.
      for (let pass = 0; pass < 3; pass++) {
        const before = state.activeRecyclers.size;
        visit(result, (n) => state.activeRecyclers.add(n.pathKey));
        if (before === state.activeRecyclers.size) break;
        result = engine.runCalculation({ db, params, state });
      }
    }
    if (result.equilibriumWarning)
      throw new Error(`自供或回收未达到平衡：${result.equilibriumWarning}`);
    if (request.selfSupply !== false && (!params.selfFuel || !params.selfFert))
      throw new Error("该路线无法满足燃料/肥料自供");
    let consumed = 0;
    if (params.selfFuel && request.item === choice.fuel)
      consumed += result.summary.fuelDemandItems;
    if (params.selfFert && request.item === choice.fertilizer)
      consumed += result.summary.fertDemandItems;
    const needed = desired + consumed;
    if (Math.abs(needed - params.targets[0].rate) < EPS * Math.max(1, needed)) {
      converged = true;
      break;
    }
    if (!Number.isFinite(needed) || needed > 1e10)
      throw new Error("目标产品的内部消耗超过可供给产量");
    params.targetRate = needed;
    params.targets[0].rate = needed;
  }
  if (!converged) throw new Error("目标产品的净交付量未收敛");
  if (Object.values(result.summary.forcedItems).some((n) => n > EPS))
    throw new Error(
      "存在未供应的原料：" + Object.keys(result.summary.forcedItems).join("、"),
    );
  const purchases = { ...result.summary.rawItems };
  if (!params.selfFuel)
    add(purchases, choice.fuel, result.summary.fuelDemandItems);
  if (!params.selfFert)
    add(purchases, choice.fertilizer, result.summary.fertDemandItems);
  let cost = 0;
  const unknown = [];
  for (const [item, rate] of Object.entries(purchases)) {
    if (rate < EPS) continue;
    const price = request.customCosts?.[item] ?? db.items[item]?.buyPrice;
    if (price == null) unknown.push(item);
    else cost += price * rate;
  }
  if (unknown.length) throw new Error("缺少外购价格：" + unknown.join("、"));
  const stepsMap = new Map();
  const balance = {};
  for (const [item, rate] of Object.entries(purchases))
    add(balance, item, rate);
  visit(result, (n) => {
    if (!n.recipe || n.isRaw || n.isExternal || n.netRate < EPS) return;
    const recipe = n.recipe;
    if (recipe.verification === "unverified")
      throw new Error(`配方尚未核验：${recipe.id}`);
    const key = keyOf(recipe);
    let step = stepsMap.get(key);
    if (!step) {
      step = {
        key,
        id: recipe.id,
        recipe: clone(recipe),
        machine: recipe.machine,
        machines: 0,
        inputs: {},
        outputs: {},
        heat: 0,
        nutrients: 0,
        fuel: 0,
        fertilizer: 0,
      };
      stepsMap.set(key, step);
    }
    step.machines += n.machineCount;
    const batches = n.netRate / n.recipeInfo.batchYield;
    for (const [item, qty] of Object.entries(recipe.inputs)) {
      const rate = qty * batches;
      add(step.inputs, item, rate);
      add(balance, item, -rate);
    }
    add(step.outputs, n.item, n.netRate);
    add(balance, n.item, n.netRate);
    for (const output of n.tags.byproducts || []) {
      add(step.outputs, output.item, output.rate);
      add(balance, output.item, output.rate);
    }
    step.heat += n.tags.heat?.heatPerSec || 0;
    step.fuel += n.tags.heat?.rate || 0;
    step.nutrients += recipe.nutrientCost ? batches * recipe.nutrientCost : 0;
    step.fertilizer += n.tags.bio?.rate || 0;
  });
  add(balance, request.item, -desired);
  add(balance, choice.fuel, -result.summary.fuelDemandItems);
  add(balance, choice.fertilizer, -result.summary.fertDemandItems);
  const deficits = Object.entries(balance).filter(
    ([, v]) => v < -EPS * Math.max(1, desired),
  );
  if (deficits.length)
    throw new Error(
      "物料守恒复核失败：" +
        deficits.map(([k, v]) => `${k} ${v.toFixed(4)}/min`).join("、"),
    );
  const steps = [...stepsMap.values()];
  for (const s of steps)
    for (const item of Object.keys(s.inputs))
      if (!obtainable.has(item))
        throw new Error(`闭环没有可获得的启动原料：${item}`);
  const machines = {};
  steps.forEach((s) => {
    s.installed = ceil(s.machines);
    s.utilization = s.installed ? s.machines / s.installed : 0;
    add(machines, s.machine, s.installed);
  });
  const heaterCount = result.construction.furnaces || 0;
  const installed =
    Object.values(machines).reduce((a, b) => a + b, 0) + heaterCount;
  const heat = steps.reduce((sum, s) => sum + s.heat, 0);
  const nutrients = steps.reduce((sum, s) => sum + s.nutrients, 0);
  const fuelEnergy =
    (result.summary.fuelDemandItems *
      (db.items[choice.fuel]?.heat || 0) *
      params.fuelMult) /
    60;
  if (Math.abs(heat - fuelEnergy) > EPS * Math.max(1, heat))
    throw new Error("热量守恒复核失败");
  const fertEnergy =
    result.summary.fertDemandItems *
    (db.items[choice.fertilizer]?.nutrientValue || 0) *
    params.fertMult;
  if (Math.abs(nutrients - fertEnergy) > EPS * Math.max(1, nutrients))
    throw new Error("营养守恒复核失败");
  const surplus = Object.fromEntries(
    Object.entries(balance).filter(([, n]) => n > EPS),
  );
  const active = steps.filter((s) => s.heat > 0);
  const installedHeat = active.reduce(
    (sum, s) => sum + (s.heat / (s.machines || 1)) * s.installed,
    0,
  );
  if (
    ![
      cost,
      installed,
      heat,
      installedHeat,
      nutrients,
      ...Object.values(balance),
    ].every(Number.isFinite)
  )
    throw new Error("该路线出现非有限计算值");
  return {
    choice,
    params,
    result,
    desired,
    purchases,
    cost,
    steps,
    machines,
    installed,
    heaterCount,
    heat,
    installedHeat,
    nutrients,
    surplus,
    score: [
      cost,
      installed,
      heat,
      Object.values(surplus).reduce((a, b) => a + b, 0),
    ],
    audit: {
      material: true,
      heat: true,
      nutrients: true,
      deficits: [],
      balance,
    },
  };
}

const compare = (a, b) => {
  for (let i = 0; i < a.score.length; i++) {
    const diff = a.score[i] - b.score[i];
    if (
      Math.abs(diff) >
      1e-7 * Math.max(1, Math.abs(a.score[i]), Math.abs(b.score[i]))
    )
      return diff;
  }
  return 0;
};

function addCauldronCandidates(db, helpers, deadline) {
  if (!helpers?.resolve3) return;
  globalThis.DB = db;
  const targets = helpers.targets();
  if (!targets.length) return;
  const pool = Object.keys(db.items).filter(
    (n) =>
      !db.items[n].liquid &&
      !db.items[n].virtual &&
      db.items[n].cauldronCost >= 0,
  );
  pool.sort(
    (a, b) =>
      (db.items[a].baseCost ?? db.items[a].buyPrice ?? Infinity) -
      (db.items[b].baseCost ?? db.items[b].buyPrice ?? Infinity),
  );
  const kept = new Map();
  const max = targets.reduce((p, c) => (p.target > c.target ? p : c)),
    min = targets.reduce((p, c) => (p.target < c.target ? p : c));
  function candidate(names, res) {
    const output = res.output;
    if (!output || names.includes(output) || !db.items[output]) return;
    const inputs = {};
    let estimate = 0;
    for (const n of names) {
      const d = db.items[n];
      const count = d.maxStack < 0 ? 1 / -d.maxStack : 1;
      add(inputs, n, count);
      estimate += (d.baseCost ?? d.buyPrice ?? 1e8) * count;
    }
    const stats = helpers.stats(db.items[output].cauldronTarget || 0);
    const r = {
      id: "AFP_CAULDRON_" + names.join("|"),
      machine: names.length === 3 ? "Cauldron" : "Advanced Cauldron",
      inputs,
      outputs: { [output]: 1 },
      baseTime: stats.time,
      heatCost: stats.heat,
    };
    if (!db.machines[r.machine]) return;
    const list = kept.get(output) || [];
    list.push({ r, estimate });
    list.sort((a, b) => a.estimate - b.estimate);
    if (list.length > 8) list.pop();
    kept.set(output, list);
  }
  // Reuse the upstream resolution functions. Include every pair; bound triples by time.
  for (let i = 0; i < pool.length; i++)
    for (let j = i; j < pool.length; j++)
      candidate(
        [pool[i], pool[j]],
        helpers.resolve2(pool[i], pool[j], targets, max, min),
      );
  outer: for (let i = 0; i < pool.length; i++)
    for (let j = i; j < pool.length; j++)
      for (let k = j; k < pool.length; k++) {
        if (performance.now() > deadline) break outer;
        candidate(
          [pool[i], pool[j], pool[k]],
          helpers.resolve3(pool[i], pool[j], pool[k], targets),
        );
      }
  for (const list of kept.values()) db.recipes.push(...list.map((x) => x.r));
}

export async function recommend(
  input,
  engine,
  request,
  { helpers, onProgress = () => {}, timeLimit = 5000 } = {},
) {
  const start = performance.now();
  const db = validateDataset(input).db;
  if (!db.items[request.item]) throw new Error("请选择有效的目标产物");
  db.settings = {
    ...db.settings,
    thermalExtractorHeight: Number(request.height ?? 255),
  };
  if (
    !Number.isFinite(db.settings.thermalExtractorHeight) ||
    db.settings.thermalExtractorHeight < 0 ||
    db.settings.thermalExtractorHeight > 255
  )
    throw new Error("萃取高度必须在 0–255 范围内");
  if (request.cauldron !== false)
    addCauldronCandidates(db, helpers, start + Math.min(700, timeLimit * 0.15));
  const fuels = Object.keys(db.items).filter((n) => db.items[n].heat > 0);
  const fertilizers = Object.keys(db.items).filter(
    (n) => db.items[n].nutrientValue > 0,
  );
  if (!fuels.length) fuels.push("无需燃料");
  if (!fertilizers.length) fertilizers.push("无需肥料");
  const recipeMap = new Map();
  db.recipes.forEach((r) => {
    for (const item of Object.keys(r.outputs)) {
      if (!recipeMap.has(item)) recipeMap.set(item, []);
      recipeMap.get(item).push(r);
    }
  });
  const preferred = {
    ...db.settings.preferredRecipes,
    ...request.preferredRecipes,
  };
  if (request.recipeId) {
    if (!recipeMap.get(request.item)?.some((r) => r.id === request.recipeId))
      throw new Error("指定配方不生产目标物品");
    preferred[request.item] = request.recipeId;
  }
  for (const [item, id] of Object.entries(preferred))
    if (!recipeMap.get(item)?.some((r) => r.id === id))
      throw new Error(`无效的固定配方：${item}`);
  const initial = {
    fuel: request.fuel || "Coal",
    fertilizer: request.fertilizer || "Basic Fertilizer",
    preferred,
    modifiers: request.modifiers || db.settings.recipeModifiers || {},
  };
  if (!fuels.includes(initial.fuel)) initial.fuel = fuels[0];
  if (!fertilizers.includes(initial.fertilizer))
    initial.fertilizer = fertilizers[0];
  const seen = new Set();
  const obtainable = obtainableItems(db, request.customCosts);
  let best = null,
    frontier = [{ choice: initial }],
    evaluated = 0;
  const failures = [];
  function check(choice) {
    const id = JSON.stringify(choice);
    if (seen.has(id)) return null;
    seen.add(id);
    try {
      const value = evaluate(db, engine, request, choice, obtainable);
      evaluated++;
      if (!best || compare(value, best) < 0) best = value;
      return value;
    } catch (e) {
      evaluated++;
      if (failures.length < 8) failures.push(e.message);
      return null;
    }
  }
  let seeds = [initial];
  for (const fuel of request.fuel ? [initial.fuel] : fuels)
    for (const fertilizer of request.fertilizer
      ? [initial.fertilizer]
      : fertilizers)
      seeds.push({ ...initial, fuel, fertilizer });
  let all = [];
  for (const choice of seeds) {
    const v = check(choice);
    if (v) all.push(v);
    if (performance.now() - start > timeLimit) break;
  }
  frontier = all.sort(compare).slice(0, 8);
  if (!frontier.length) frontier = [{ choice: initial }];
  for (
    let round = 0;
    round < 6 && performance.now() - start < timeLimit;
    round++
  ) {
    const candidates = [...frontier.filter((x) => x.score)];
    for (const entry of frontier) {
      const dependencies = new Set([request.item]);
      if (entry.result) visit(entry.result, (n) => dependencies.add(n.item));
      else for (const item of recipeMap.keys()) dependencies.add(item);
      for (const item of dependencies) {
        if (preferred[item]) continue;
        for (const recipe of recipeMap.get(item) || []) {
          const choice = {
            ...entry.choice,
            preferred: { ...entry.choice.preferred, [item]: recipe.id },
          };
          const value = check(choice);
          if (value) candidates.push(value);
          if (
            recipe.machine === "Advanced Athanor" &&
            !request.modifiers?.[recipe.id]
          ) {
            const types = ["unstable", "fertile", "resonant", "eternal"];
            for (
              let mask = 1;
              mask < 16 && performance.now() - start < timeLimit;
              mask++
            ) {
              const modifiers = {
                ...choice.modifiers,
                [recipe.id]: {
                  catalysts: types.filter((_, bit) => mask & (1 << bit)),
                },
              };
              const alternative = check({ ...choice, modifiers });
              if (alternative) candidates.push(alternative);
            }
          }
          if (recipe.customInputSlot && !request.modifiers?.[recipe.id]) {
            const inputs = Object.keys(db.items).filter(
              (n) =>
                db.items[n].baseCost > 0 &&
                !db.items[n].virtual &&
                !db.items[n].liquid,
            );
            for (const input of inputs) {
              if (performance.now() - start > timeLimit) break;
              const alternative = check({
                ...choice,
                modifiers: {
                  ...choice.modifiers,
                  [recipe.id]: { customInput: input },
                },
              });
              if (alternative) candidates.push(alternative);
            }
          }
          if (performance.now() - start > timeLimit) break;
        }
        if (performance.now() - start > timeLimit) break;
      }
      if (performance.now() - start > timeLimit) break;
    }
    candidates.sort(compare);
    const next = candidates.slice(0, 8);
    onProgress({
      evaluated,
      round: round + 1,
      elapsed: performance.now() - start,
    });
    if (!next.length) break;
    const unchanged =
      next.length === frontier.length &&
      next.every(
        (x, i) =>
          JSON.stringify(x.choice) === JSON.stringify(frontier[i]?.choice),
      );
    frontier = next;
    if (unchanged) break;
    await new Promise((r) => setTimeout(r, 0));
  }
  if (!best)
    throw new Error(
      "没有找到满足供给与守恒条件的路线。" +
        [...new Set(failures)].slice(0, 4).join("；"),
    );
  const settings = {
    ...db.settings,
    ...Object.fromEntries([
      ["lvlBelt", request.levels?.logistics || 0],
      ["lvlSpeed", request.levels?.factory || 0],
      ["lvlAlchemy", request.levels?.alchemy || 0],
      ["lvlFuel", request.levels?.fuel || 0],
      ["lvlFert", request.levels?.fertilizer || 0],
    ]),
    defaultFuel: best.choice.fuel,
    defaultFert: best.choice.fertilizer,
    selectedHeatingDevice: best.params.selectedHeatingDevice,
    preferredRecipes: best.choice.preferred,
    recipeModifiers: best.choice.modifiers,
  };
  const plan = {
    schemaVersion: 1,
    request: clone(request),
    dataVersion: db.version,
    metadata: db.metadata,
    createdAt: new Date().toISOString(),
    ...Object.fromEntries(
      [
        "desired",
        "purchases",
        "cost",
        "steps",
        "machines",
        "installed",
        "heaterCount",
        "heat",
        "installedHeat",
        "nutrients",
        "surplus",
        "audit",
      ].map((k) => [k, best[k]]),
    ),
    fuel: best.choice.fuel,
    fertilizer: best.choice.fertilizer,
    fuelRate: best.result.summary.fuelDemandItems,
    fertilizerRate: best.result.summary.fertDemandItems,
    settings,
    startup: best.result.construction.extraBuildCosts,
    search: {
      evaluated,
      elapsedMs: Math.round(performance.now() - start),
      timedOut: performance.now() - start >= timeLimit,
      globalOptimum: false,
    },
  };
  plan.constructionCosts = {};
  for (const [machine, count] of Object.entries({
    ...plan.machines,
    [plan.settings.selectedHeatingDevice]: plan.heaterCount,
  }))
    for (const [item, qty] of Object.entries(
      db.machines[machine]?.buildCost || {},
    ))
      add(plan.constructionCosts, item, qty * count);
  for (const [item, qty] of Object.entries(plan.constructionCosts))
    if (/seed/i.test(item)) add(plan.startup, item, qty);
  // A steady-state fuel loop still needs an initial buffer to light the first batch.
  const available = new Set([
    ...Object.keys(plan.purchases),
    ...Object.keys(plan.startup),
  ]);
  let pending = [...plan.steps];
  for (let pass = 0; pending.length && pass < plan.steps.length + 4; pass++) {
    const ready = pending.filter(
      (s) =>
        Object.keys(s.inputs).every((k) => available.has(k)) &&
        (!s.fuel || available.has(plan.fuel)) &&
        (!s.fertilizer || available.has(plan.fertilizer)),
    );
    if (ready.length) {
      for (const s of ready)
        for (const k of Object.keys(s.outputs)) available.add(k);
      pending = pending.filter((s) => !ready.includes(s));
      continue;
    }
    let seeded = false;
    for (const [item, needs, unit] of [
      [
        plan.fuel,
        pending.some((s) => s.fuel > 0),
        db.items[plan.fuel]?.heat * best.params.fuelMult,
      ],
      [
        plan.fertilizer,
        pending.some((s) => s.fertilizer > 0),
        db.items[plan.fertilizer]?.nutrientValue * best.params.fertMult,
      ],
    ]) {
      if (needs && !available.has(item)) {
        const buffer = ceil(
          pending.reduce(
            (sum, s) =>
              sum +
              (item === plan.fuel
                ? (s.heat * (s.recipe.baseTime || 1)) / best.params.speedMult
                : (s.recipe.nutrientCost || 0) * s.installed),
            0,
          ) / (unit || 1),
        );
        add(plan.startup, item, Math.max(1, buffer));
        available.add(item);
        seeded = true;
      }
    }
    if (!seeded) {
      const step = pending[0];
      const missing = Object.keys(step.inputs).find((k) => !available.has(k));
      if (missing) {
        add(
          plan.startup,
          missing,
          Math.max(1, step.recipe.inputs[missing] || 1),
        );
        available.add(missing);
      } else break;
    }
  }
  plan.graph = buildGraph(plan);
  return { plan, db };
}

function buildGraph(plan) {
  const nodes = {},
    edges = {};
  let seq = 0,
    eSeq = 0;
  const ports = [];
  const put = (
    recipe,
    machine,
    count,
    inputs,
    outputs,
    x,
    y,
    heat = 0,
    fert = 0,
  ) => {
    const id = "n" + ++seq;
    nodes[id] = {
      id,
      kind: "recipe",
      recipeId: recipe.id,
      machineCount: count,
      x,
      y,
      resolved: {
        recipe,
        inputsPerMachine: Object.entries(inputs).map(([item, rate]) => ({
          item,
          rate: rate / count,
        })),
        outputsPerMachine: Object.entries(outputs).map(([item, rate]) => ({
          item,
          rate: rate / count,
        })),
        heatItemsPerMachine: heat / count,
        fertItemsPerMachine: fert / count,
        goldCostPerMachine: 0,
        errorCode: "",
      },
    };
    ports.push({ id, inputs: { ...inputs }, outputs: { ...outputs } });
    return id;
  };
  plan.steps.forEach((s, i) =>
    put(
      s.recipe,
      s.machine,
      s.machines,
      s.inputs,
      s.outputs,
      350 + (i % 4) * 280,
      80 + Math.floor(i / 4) * 310,
      s.fuel,
      s.fertilizer,
    ),
  );
  Object.entries(plan.purchases).forEach(([item, rate], i) =>
    put(
      {
        id: "boundary-buy:" + item,
        machine: "采购",
        inputs: {},
        outputs: { [item]: 1 },
        baseTime: 60,
      },
      "采购",
      1,
      {},
      { [item]: rate },
      20,
      i * 180,
    ),
  );
  const sinks = { [plan.request.item]: plan.desired };
  add(sinks, plan.fuel, plan.fuelRate);
  add(sinks, plan.fertilizer, plan.fertilizerRate);
  Object.entries(sinks)
    .filter(([, n]) => n > EPS)
    .forEach(([item, rate], i) =>
      put(
        {
          id: "boundary-deliver:" + item,
          machine: item === plan.request.item ? "净交付" : "内部供给",
          inputs: { [item]: 1 },
          outputs: {},
          baseTime: 60,
        },
        "净交付",
        1,
        { [item]: rate },
        {},
        1600,
        i * 200,
      ),
    );
  for (const consumer of ports)
    for (const [item, requested] of Object.entries(consumer.inputs)) {
      let remaining = requested;
      // Prefer secondary outputs for recycling before consuming additional main output.
      const producers = ports
        .filter((p) => p.outputs[item] > EPS)
        .sort(
          (a, b) =>
            Number(
              Object.keys(nodes[a.id].resolved.recipe.outputs)[0] === item,
            ) -
            Number(
              Object.keys(nodes[b.id].resolved.recipe.outputs)[0] === item,
            ),
        );
      for (const p of producers) {
        const flow = Math.min(remaining, p.outputs[item]);
        if (flow < EPS) continue;
        const id = "e" + ++eSeq;
        edges[id] = {
          id,
          item,
          fromNode: p.id,
          toNode: consumer.id,
          createdAt: eSeq,
        };
        p.outputs[item] -= flow;
        remaining -= flow;
        if (remaining < EPS) break;
      }
    }
  return {
    nodes,
    edges,
    _nodeSeq: seq,
    _edgeSeq: eSeq,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function describePlan(plan, translations = {}) {
  const name = (k) =>
    translations.items?.[k] || translations.machines?.[k] || k;
  const n = (v) => Number(v.toFixed(5)).toLocaleString("zh-CN");
  const lines = [
    `${name(plan.request.item)} · 产线方案`,
    `目标净交付：${n(plan.desired)} 个/分钟`,
    `持续采购：${n(plan.cost)} 铜/分钟`,
    `实际热耗：${n(plan.heat)} /秒；整数安装容量热耗：${n(plan.installedHeat)} /秒`,
    "",
    "采购清单",
  ];
  Object.entries(plan.purchases)
    .filter(([, r]) => r > EPS)
    .forEach(([k, v]) => lines.push(`  ${name(k)}：${n(v)} /分钟`));
  lines.push("", "加工步骤");
  plan.steps.forEach((s, i) => {
    lines.push(
      `${i + 1}. ${name(s.machine)} × ${s.installed}（理论 ${n(s.machines)}，利用率 ${n(s.utilization * 100)}%）`,
    );
    lines.push(
      `   ${
        Object.entries(s.inputs)
          .map(([k, v]) => `${name(k)} ${n(v)}/分`)
          .join(" + ") || "无持续原料"
      } → ${Object.entries(s.outputs)
        .map(([k, v]) => `${name(k)} ${n(v)}/分`)
        .join(" + ")}`,
    );
  });
  lines.push(
    "",
    `燃料：${name(plan.fuel)} ${n(plan.fuelRate)} /分钟`,
    `肥料：${name(plan.fertilizer)} ${n(plan.fertilizerRate)} /分钟`,
    `加热设备：${name(plan.settings.selectedHeatingDevice)} × ${plan.heaterCount}`,
  );
  if (Object.keys(plan.startup || {}).length) {
    lines.push("", "一次性启动材料");
    Object.entries(plan.startup).forEach(([k, v]) =>
      lines.push(`  ${name(k)} × ${n(v)}`),
    );
  }
  if (Object.keys(plan.constructionCosts || {}).length) {
    lines.push("", "设备建造材料");
    Object.entries(plan.constructionCosts).forEach(([k, v]) =>
      lines.push(`  ${name(k)} × ${n(v)}`),
    );
  }
  if (Object.keys(plan.surplus).length) {
    lines.push("", "剩余副产物");
    Object.entries(plan.surplus).forEach(([k, v]) =>
      lines.push(`  ${name(k)}：${n(v)} /分钟`),
    );
  }
  lines.push(
    "",
    `已复核物料、热量与营养平衡。比较 ${plan.search.evaluated} 个候选；${plan.search.timedOut ? "达到搜索时限，保留当前推荐" : "有界搜索完成"}，未证明全局最优。`,
    "概率配方按长期平均产量计算，搭建时需要缓冲库存。",
  );
  return lines.join("\n");
}
