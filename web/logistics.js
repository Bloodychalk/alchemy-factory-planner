const EPS = 1e-7;
export function buildDetailedPlan(plan, db, rules) {
  try {
    return generate(plan, db, rules);
  } catch (e) {
    return blocked([e.message]);
  }
}
function generate(plan, db, rules) {
  if (
    db.gameVersion &&
    rules.gameVersion &&
    db.gameVersion !== rules.gameVersion &&
    !db.logistics
  )
    return blocked(["资料版本与物流规则版本不一致"]);
  const deadline = performance.now() + 10000;

  const nodes = [],
    edges = [],
    issues = [];
  let seq = 0,
    portCount = 0;
  const profile = (name) =>
    db.logistics?.machines?.[name] ||
    (!db.gameVersion || db.gameVersion === rules.gameVersion
      ? rules.machines[name]
      : null);
  const add = (kind, label, ports = [], extra = {}) => {
    if (nodes.length >= 10000 || performance.now() > deadline)
      throw new Error("详细规划超出节点或时间上限");
    if (["splitter", "merger", "filter"].includes(kind) &&
        rules.logisticsDevices?.[kind]?.status !== "verified")
      throw new Error(`${label}：缺少已核实物流构件规则`);
    const n = { id: `d${++seq}`, kind, label, ports, ...extra };
    nodes.push(n);
    return n;
  };
  const medium = (i) => (db.items[i]?.liquid ? "pipe" : "belt");
  const port = (n, dir, item, rate) => {
    if (++portCount > 60000 || performance.now() > deadline)
      throw new Error("详细网络超出端口或时间上限");
    const p = { id: `${n.id}:${dir}:${n.ports.length}`, dir, item, rate };
    n.ports.push(p);
    return p;
  };
  const wire = (a, b, item, rate, kind = medium(item)) => {
    if (edges.length >= 30000 || performance.now() > deadline)
      throw new Error("详细网络超出线路或时间上限");
    return edges.push({
      id: `b${edges.length + 1}`,
      source: a.id.split(":")[0],
      target: b.id.split(":")[0],
      sourcePort: a.id,
      targetPort: b.id,
      item,
      rate,
      kind,
      capacity: kind === "heat" ? null : cap(item),
    });
  };
  const belt =
    60 +
    Math.min(plan.request.levels?.logistics || 0, 12) * 15 +
    Math.max(0, (plan.request.levels?.logistics || 0) - 12) * 3;
  const cap = (item) =>
    medium(item) === "pipe"
      ? db.logistics.pipeCapacity
      : belt * (db.items[item]?.category === "Currency" ? 50 : 1);
  const supplies = new Map(),
    demands = new Map();
  const register = (map, p) => {
    if (!map.has(p.item)) map.set(p.item, []);
    map.get(p.item).push(p);
  };
  const requireProfile = (name) => {
    const p = profile(name);
    if (
      !p ||
      p.status !== "verified" ||
      ![p.beltIn, p.beltOut, p.pipeIn ?? 0, p.pipeOut ?? 0].every(
        (n) => Number.isInteger(n) && n >= 0 && n <= 64,
      )
    ) {
      issues.push(`${name}：缺少已核实接口规则`);
      return null;
    }
    return { ...p, pipeIn: p.pipeIn ?? 0, pipeOut: p.pipeOut ?? 0 };
  };
  const scale = (values, k) =>
    Object.fromEntries(
      Object.entries(values)
        .filter(([, r]) => r > EPS)
        .map(([i, r]) => [i, r * k]),
    );
  const groups = [];
  for (const s of plan.steps) {
    const p = requireProfile(s.machine);
    if (!p) continue;
    const ins = Object.keys(s.inputs).filter((i) => s.inputs[i] > EPS),
      outs = Object.keys(s.outputs).filter((i) => s.outputs[i] > EPS);
    if (
      [...ins, ...outs].some((i) => db.items[i]?.liquid) &&
      !(
        Number.isFinite(db.logistics?.pipeCapacity) &&
        db.logistics.pipeCapacity > 0
      )
    ) {
      issues.push(`${s.machine}：管道吞吐与介质规则待核实`);
      continue;
    }
    if (
      [...ins, ...outs].some(
        (i) => db.items[i]?.virtual && !db.items[i]?.liquid,
      )
    ) {
      issues.push(`${s.machine}：虚拟组合物需转换为实际物品`);
      continue;
    }
    if (
      ins.filter((i) => medium(i) === "belt").length +
        Number(s.fertilizer > EPS) >
        p.beltIn ||
      ins.filter((i) => medium(i) === "pipe").length > (p.pipeIn || 0)
    ) {
      issues.push(
        `${s.machine}：${ins.length} 种原料共用 ${p.beltIn} 个入口的混带控制规则待核实`,
      );
      continue;
    }
    if (
      (outs.some((i) => medium(i) === "belt") && !p.beltOut) ||
      (outs.some((i) => medium(i) === "pipe") && !p.pipeOut)
    ) {
      issues.push(`${s.machine}：缺少固体输出口`);
      continue;
    }
    let limit = 1;
    for (const i of ins)
      limit = Math.min(limit, cap(i) / (s.inputs[i] / s.machines));
    // Shared outputs occupy the same physical belt; filter them immediately downstream.
    const outputLoads = Array.from({ length: p.beltOut + p.pipeOut }, () => 0);
    outs.forEach(
      (i, j) =>
        (outputLoads[
          medium(i) === "pipe" ? p.beltOut + (j % p.pipeOut) : j % p.beltOut
        ] += s.outputs[i] / s.machines / cap(i)),
    );
    for (const load of outputLoads)
      if (load > 0) limit = Math.min(limit, 1 / load);
    if (s.fertilizer > 0)
      limit = Math.min(
        limit,
        cap(plan.fertilizer) / (s.fertilizer / s.machines),
      );
    if (s.fuel > 0)
      limit = Math.min(limit, cap(plan.fuel) / (s.fuel / s.machines));
    if (!Number.isFinite(limit) || limit <= EPS) {
      issues.push(`${s.machine}：单台吞吐无可行值`);
      continue;
    }
    const heater = s.heat > EPS ? plan.settings.selectedHeatingDevice : null;
    if (heater) {
      const hp = requireProfile(heater);
      if (!hp) continue;
      if (heater === "Steam Heating Pad") {
        issues.push("Steam Heating Pad：蒸汽转换及管道规则待核实");
        continue;
      }
      if (hp.beltIn < 1 || (db.machines[heater]?.heatSelf || 0) !== 0) {
        issues.push(`${heater}：燃料口或基础热耗规则待核实`);
        continue;
      }
      const h = db.machines[heater],
        m = db.machines[s.machine];
      if (
        !h?.L ||
        !m?.L ||
        !((m.L <= h.L && m.W <= h.W) || (m.W <= h.L && m.L <= h.W))
      ) {
        issues.push(`${s.machine}：与 ${heater} 的单机供热兼容性未确认`);
        continue;
      }
    }
    const count = Math.ceil((s.machines - EPS) / limit);
    if (count + nodes.length > 10000)
      return blocked(["详细网络超过 10,000 个节点"]);
    groups.push({ s, count, limit });
    let remaining = s.machines;
    for (let j = 0; j < count; j++) {
      const load = Math.min(limit, remaining);
      remaining -= load;
      const ratio = load / s.machines;
      const n = add("machine", `${s.machine} #${j + 1}`, [], {
        group: s.key,
        machine: s.machine,
        load,
        fertilizerDemand: s.fertilizer * ratio,
        fertilizerItem: plan.fertilizer,
        heatDemand: s.heat * ratio,
        nutrientDemand: (s.nutrients || 0) * ratio,
        mainItem: Object.keys(s.recipe.outputs)[0],
        transportLimit: limit,
        inputs: scale(s.inputs, ratio),
        outputs: scale(s.outputs, ratio),
      });
      for (const [i, r] of Object.entries(n.inputs))
        register(demands, port(n, "in", i, r));
      if (s.fertilizer > EPS)
        register(demands, port(n, "in", plan.fertilizer, s.fertilizer * ratio));
      const bins = Array.from({ length: p.beltOut + p.pipeOut }, () => []);
      outs.forEach((i, k) =>
        bins[
          medium(i) === "pipe" ? p.beltOut + (k % p.pipeOut) : k % p.beltOut
        ].push(i),
      );
      for (const bin of bins.filter((x) => x.length)) {
        if (bin.length === 1) {
          const i = bin[0];
          register(supplies, port(n, "out", i, n.outputs[i]));
          continue;
        }
        if (bin.some((i) => medium(i) === "pipe"))
          return blocked([`${s.machine}：不同液体不可共用同一管道`]);
        // A filter splitter has one mixed input and two physical outputs.
        let mixed = port(
          n,
          "out",
          bin.join(" + "),
          bin.reduce((v, i) => v + n.outputs[i], 0),
        );
        for (let k = 0; k < bin.length - 1; k++) {
          const rest = bin.slice(k),
            total = rest.reduce((v, i) => v + n.outputs[i], 0),
            f = add("filter", `过滤分流 · ${bin[k]}`);
          const input = port(f, "in", rest.join(" + "), total);
          wire(mixed, input, input.item, total);
          edges.at(-1).flows = Object.fromEntries(
            rest.map((i) => [i, n.outputs[i]]),
          );
          register(supplies, port(f, "out", bin[k], n.outputs[bin[k]]));
          mixed = port(
            f,
            "out",
            rest.slice(1).join(" + "),
            total - n.outputs[bin[k]],
          );
        }
        mixed.item = bin.at(-1);
        register(supplies, mixed);
      }
      if (heater) {
        const h = add(
          "heater",
          `${heater} #${nodes.filter((x) => x.kind === "heater").length + 1}`,
          [],
          { machine: heater },
        );
        register(demands, port(h, "in", plan.fuel, s.fuel * ratio));
        const a = port(h, "out", "热量", s.heat * ratio),
          b = port(n, "in", "热量", s.heat * ratio);
        wire(a, b, "热量", s.heat * ratio, "heat");
      }
    }
  }
  if (issues.length) return blocked([...new Set(issues)]);
  for (const [item, rate] of Object.entries(plan.purchases).filter(
    ([, r]) => r > EPS,
  )) {
    if (db.items[item]?.liquid) return blocked([`${item}：外购液体接口待核实`]);
    if (db.items[item]?.category === "Currency") {
      if (!(requireProfile("Bank Portal")?.beltOut >= 1))
        return blocked([...issues, "Bank Portal：无可用输出口"]);
      let rest = rate;
      while (rest > EPS) {
        const r = Math.min(rest, cap(item));
        rest -= r;
        const n = add("bank", `Bank Portal · ${item}`, [], {
          machine: "Bank Portal",
          externalFunds: r,
        });
        register(supplies, port(n, "out", item, r));
      }
      continue;
    }
    const p = requireProfile("Purchasing Portal");
    if (!p) return blocked(issues);
    if (p.beltOut < 1) return blocked(["Purchasing Portal：无可用输出口"]);
    const price =
      plan.request.customCosts?.[item] ?? db.items[item]?.buyPrice ?? 0;
    if (price > 0 && p.beltIn < 1)
      return blocked(["Purchasing Portal：无可用货币入口"]);
    const portalCapacity = Math.min(
      cap(item),
      price > 0 ? cap("Copper Coin") / price : Infinity,
    );
    const count = Math.ceil((rate - EPS) / portalCapacity);
    let rest = rate;
    for (let j = 0; j < count; j++) {
      const r = Math.min(rest, portalCapacity);
      rest -= r;
      const n = add("purchase", `Purchasing Portal · ${item} #${j + 1}`, [], {
        machine: "Purchasing Portal",
        expense: r * price,
      });
      register(supplies, port(n, "out", item, r));
      const cost = r * price;
      if (cost > EPS) register(demands, port(n, "in", "Copper Coin", cost));
    }
  }
  const coinDemand = (demands.get("Copper Coin") || []).reduce(
    (v, p) => v + p.rate,
    0,
  );
  const coinMissing =
    coinDemand -
    (supplies.get("Copper Coin") || []).reduce((v, p) => v + p.rate, 0);
  if (coinMissing > EPS) {
    if (!(requireProfile("Bank Portal")?.beltOut >= 1))
      return blocked([...issues, "Bank Portal：无可用输出口"]);
    let rest = coinMissing;
    while (rest > EPS) {
      const r = Math.min(rest, cap("Copper Coin"));
      rest -= r;
      const n = add("bank", "Bank Portal · 外部资金", [], {
        machine: "Bank Portal",
        externalFunds: r,
      });
      register(supplies, port(n, "out", "Copper Coin", r));
    }
  }
  const terminal = (item, rate, label) => {
    if (rate <= EPS) return;
    const n = add("terminal", `${label} · ${item}`);
    let rest = rate;
    while (rest > EPS) {
      const r = Math.min(rest, cap(item));
      rest -= r;
      register(demands, port(n, "in", item, r));
    }
  };
  terminal(plan.request.item, plan.desired, "成品");
  for (const [i, r] of Object.entries(plan.surplus)) terminal(i, r, "副产物");
  // Allocate each material once. Every fan-out/fan-in becomes a binary junction.
  for (const [item, consumers] of demands) {
    const producers = (supplies.get(item) || [])
      .slice()
      .sort(
        (a, b) =>
          Number(
            nodes.find((n) => n.id === a.id.split(":")[0])?.mainItem === item,
          ) -
          Number(
            nodes.find((n) => n.id === b.id.split(":")[0])?.mainItem === item,
          ),
      )
      .map((p) => ({
        p,
        left: p.rate,
        links: [],
      }));
    const incoming = new Map();
    for (const c of consumers) {
      let left = c.rate;
      const list = [];
      for (const source of producers) {
        const r = Math.min(left, source.left);
        if (r <= EPS) continue;
        source.left -= r;
        left -= r;
        const link = { source, c, rate: r };
        source.links.push(link);
        list.push(link);
        if (left < EPS) break;
      }
      if (left > 1e-5) return blocked([`${item}：逐台连接仍缺少 ${left}/分钟`]);
      incoming.set(c, list);
    }
    for (const source of producers) {
      if (source.left > 1e-5) return blocked([`${item}：存在未安排的设备输出`]);
      const split = (upstream, links) => {
        if (links.length === 1) {
          links[0].out = upstream;
          return;
        }
        const mid = Math.ceil(links.length / 2),
          left = links.slice(0, mid),
          right = links.slice(mid);
        const amount = (xs) => xs.reduce((v, l) => v + l.rate, 0);
        const n = add(
          medium(item) === "pipe" ? "junction" : "splitter",
          `${medium(item) === "pipe" ? "管道三通" : "优先分流"} · ${item}`,
        );
        wire(upstream, port(n, "in", item, amount(links)), item, amount(links));
        const first = port(n, "out", item, amount(left));
        first.priority = true;
        split(first, left);
        split(port(n, "out", item, amount(right)), right);
      };
      if (source.links.length) split(source.p, source.links);
    }
    const merge = (links) => {
      if (links.length === 1) return links[0].out;
      const mid = Math.ceil(links.length / 2),
        left = links.slice(0, mid),
        right = links.slice(mid);
      const amount = (xs) => xs.reduce((v, l) => v + l.rate, 0);
      const a = merge(left),
        b = merge(right),
        n = add(
          medium(item) === "pipe" ? "junction" : "merger",
          `${medium(item) === "pipe" ? "管道三通" : "优先合流"} · ${item}`,
        );
      const first = port(n, "in", item, amount(left));
      first.priority = true;
      wire(a, first, item, amount(left));
      wire(b, port(n, "in", item, amount(right)), item, amount(right));
      return port(n, "out", item, amount(links));
    };
    for (const [c, list] of incoming)
      if (list.length) wire(merge(list), c, item, c.rate);
  }

  if (nodes.length > 10000 || edges.length > 30000)
    return blocked(["详细网络超过节点或连接数量上限"]);
  const detail = {
    version: 1,
    status: "ready",
    rulesVersion: rules.version,
    fuel: plan.fuel,
    effectiveFuelHeat:
      (db.items[plan.fuel]?.heat || 0) *
      (1 + (plan.request.levels?.fuel || 0) * 0.1),
    effectiveNutrients:
      (db.items[plan.fertilizer]?.nutrientValue || 0) *
      (1 + (plan.request.levels?.fertilizer || 0) * 0.1),
    nodes,
    edges,
    groups,
  };
  const errors = auditDetailedPlan(detail);
  if (errors.length) return blocked(errors);
  return detail;
}
function blocked(issues) {
  return { version: 1, status: "blocked", issues };
}
export function auditDetailedPlan(detail) {
  const errors = [],
    ports = new Map(detail.nodes.flatMap((n) => n.ports.map((p) => [p.id, p]))),
    owners = new Map(detail.nodes.flatMap((n) => n.ports.map((p) => [p.id, n.id]))),
    counts = new Map();
  if (ports.size !== detail.nodes.reduce((v, n) => v + n.ports.length, 0))
    errors.push("端口标识重复");
  for (const e of detail.edges) {
    const a = ports.get(e.sourcePort),
      b = ports.get(e.targetPort);
    if (
      !a ||
      !b ||
      a.dir !== "out" ||
      b.dir !== "in" ||
      owners.get(e.sourcePort) !== e.source ||
      owners.get(e.targetPort) !== e.target ||
      a.item !== e.item || b.item !== e.item ||
      ![a.rate, b.rate].every(Number.isFinite) ||
      !Number.isFinite(e.rate) ||
      e.rate <= 0
    ) {
      errors.push("连接端口或流量无效");
      continue;
    }
    if (e.kind !== "heat" &&
        (!Number.isFinite(e.capacity) || e.capacity <= 0 || e.rate > e.capacity + 1e-5))
      errors.push(`${e.item}：单带超载`);
    if (e.flows &&
        (!Object.values(e.flows).every((v) => Number.isFinite(v) && v > 0) ||
         Math.abs(Object.values(e.flows).reduce((v, r) => v + r, 0) - e.rate) > 1e-5))
      errors.push(`${e.item}：混带物料流量无效`);
    for (const p of [a, b]) {
      counts.set(p.id, (counts.get(p.id) || 0) + 1);
      if (Math.abs(p.rate - e.rate) > 1e-5)
        errors.push(`${p.id}：端口流量不守恒`);
    }
  }
  for (const [id, p] of ports)
    if (p.rate > EPS && counts.get(id) !== 1)
      errors.push(`${id}：端口未连接或重复连接`);
  for (const n of detail.nodes)
    if (["splitter", "merger", "filter", "junction"].includes(n.kind)) {
      const ins = n.ports.filter((p) => p.dir === "in"),
        outs = n.ports.filter((p) => p.dir === "out");
      if (
        Math.abs(
          ins.reduce((v, p) => v + p.rate, 0) -
            outs.reduce((v, p) => v + p.rate, 0),
        ) > 1e-5
      )
        errors.push(`${n.id}：物流节点不守恒`);
    }
  const incoming = new Map(),
    outgoing = new Map();
  const acc = (map, id, flows) => {
    const v = map.get(id) || {};
    for (const [i, r] of Object.entries(flows)) v[i] = (v[i] || 0) + r;
    map.set(id, v);
  };
  for (const e of detail.edges) {
    const flows = e.flows || { [e.item]: e.rate };
    acc(incoming, e.target, flows);
    acc(outgoing, e.source, flows);
  }
  const equal = (a, b) =>
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach((i) => {
      if (![a[i] ?? 0, b[i] ?? 0].every(Number.isFinite) ||
          Math.abs((a[i] || 0) - (b[i] || 0)) > 1e-5)
        errors.push(`${i}：逐设备物料不守恒`);
    });
  for (const n of detail.nodes) {
    if (["splitter", "merger", "filter", "junction"].includes(n.kind))
      equal(incoming.get(n.id) || {}, outgoing.get(n.id) || {});
    if (n.kind === "heater") {
      const fuel = (incoming.get(n.id) || {})[detail.fuel] || 0;
      const heat = (outgoing.get(n.id) || {})["热量"] || 0;
      if (Math.abs((fuel * detail.effectiveFuelHeat) / 60 - heat) > 1e-5)
        errors.push(`${n.id}：供热能量不守恒`);
    }
    if (n.kind === "machine") {
      if (
        Math.abs(
          (n.fertilizerDemand || 0) * detail.effectiveNutrients -
            (n.nutrientDemand || 0),
        ) > 1e-5
      )
        errors.push(`${n.id}：营养不守恒`);
      const expected = { ...n.inputs };
      if (n.fertilizerDemand)
        expected[n.fertilizerItem] =
          (expected[n.fertilizerItem] || 0) + n.fertilizerDemand;
      if (n.heatDemand) expected["热量"] = n.heatDemand;
      equal(expected, incoming.get(n.id) || {});
      equal(n.outputs, outgoing.get(n.id) || {});
    }
  }
  return errors;
}
