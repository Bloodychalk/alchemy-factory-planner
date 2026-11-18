// Parse the pinned upstream's data literals without executing imported data.
export function readLiteral(source, marker) {
  let i = source.indexOf(marker);
  if (i < 0) throw new Error(`参考文件缺少 ${marker}`);
  i += marker.length;
  const skip = () => {
    for (;;) {
      while (/\s/.test(source[i] || "") && i < source.length) i++;
      if (source.slice(i, i + 2) === "//") {
        i = source.indexOf("\n", i);
        if (i < 0) i = source.length;
      } else if (source.slice(i, i + 2) === "/*") {
        const end = source.indexOf("*/", i + 2);
        if (end < 0) throw new Error("未闭合的注释");
        i = end + 2;
      } else break;
    }
  };
  const value = () => {
    skip();
    const c = source[i++];
    if (c === "{") {
      const o = Object.create(null);
      skip();
      while (source[i] !== "}") {
        skip();
        const quoted = /['"]/.test(source[i]);
        const key = quoted ? value() : source.slice(i).match(/^[\w$]+/)?.[0];
        if (!key || ["__proto__", "constructor", "prototype"].includes(key))
          throw new Error("非法字段");
        if (!quoted) i += key.length;
        skip();
        if (source[i++] !== ":") throw new Error("字段缺少冒号");
        o[key] = value();
        skip();
        if (source[i] !== ",") break;
        i++;
        skip();
      }
      if (source[i++] !== "}") throw new Error("对象格式错误");
      return o;
    }
    if (c === "[") {
      const a = [];
      skip();
      while (source[i] !== "]") {
        a.push(value());
        skip();
        if (source[i] !== ",") break;
        i++;
        skip();
      }
      if (source[i++] !== "]") throw new Error("数组格式错误");
      return a;
    }
    if (c === '"' || c === "'") {
      let s = "";
      while (i < source.length) {
        const ch = source[i++];
        if (ch === c) return s;
        if (ch !== "\\") {
          s += ch;
          continue;
        }
        const e = source[i++];
        if (e === "u") {
          const hex = source.slice(i, i + 4);
          if (!/^[0-9a-f]{4}$/i.test(hex)) throw new Error("无效 Unicode");
          s += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else s += { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[e] ?? e;
      }
      throw new Error("字符串未闭合");
    }
    i--;
    const token = source
      .slice(i)
      .match(/^(?:-?\d+(?:\.\d*)?(?:e[+-]?\d+)?|true|false|null)/i)?.[0];
    if (!token)
      throw new Error(`不支持的数据表达式：${source.slice(i, i + 25)}`);
    i += token.length;
    return JSON.parse(token);
  };
  return value();
}

export const clone = (value) => JSON.parse(JSON.stringify(value));
export function canonicalizeDataset(input, translations = {}) {
  const db = clone(input);
  const reverse = new Map(
    Object.entries(translations.items || {}).map(([k, v]) => [v, k]),
  );
  const name = (k) => reverse.get(k) || k;
  const mapped = (o) => {
    const result = {};
    for (const [k, v] of Object.entries(o || {})) {
      const target = name(k);
      if (Object.hasOwn(result, target))
        throw new Error(`物品名称重复：${target}`);
      result[target] = v;
    }
    return result;
  };
  if (db.items) db.items = mapped(db.items);
  for (const recipe of db.recipes || [])
    for (const field of [
      "inputs",
      "outputs",
      "unstableOutputs",
      "resonantOutputs",
    ])
      if (recipe[field]) recipe[field] = mapped(recipe[field]);
  for (const recipe of db.recipes || [])
    if (typeof recipe.buildCost === "string")
      recipe.buildCost = name(recipe.buildCost);
  for (const machine of Object.values(db.machines || {}))
    if (machine.buildCost) machine.buildCost = mapped(machine.buildCost);
  if (db.settings) {
    for (const field of ["defaultFuel", "defaultFert", "targetItem"])
      if (db.settings[field]) db.settings[field] = name(db.settings[field]);
    for (const field of ["preferredRecipes", "customCosts"])
      if (db.settings[field]) db.settings[field] = mapped(db.settings[field]);
    for (const modifier of Object.values(db.settings.recipeModifiers || {}))
      if (modifier.customInput)
        modifier.customInput = name(modifier.customInput);
  }
  return db;
}
export function validateDataset(input) {
  const db = clone(input);
  const errors = [];
  const warnings = [];
  const record = (value) =>
    value && typeof value === "object" && !Array.isArray(value);
  for (const key of ["items", "machines"])
    if (!record(db[key]) || !Object.keys(db[key]).length)
      errors.push(`${key} 必须是非空对象`);
  if (!Array.isArray(db.recipes)) errors.push("recipes 必须是数组");
  if (errors.length) throw new Error(errors.join("\n"));
  if (db.schemaVersion != null && db.schemaVersion !== 1)
    errors.push("不支持该 JSON schemaVersion");
  const safeKey = (key) =>
    !["__proto__", "constructor", "prototype"].includes(key);
  for (const [name, item] of Object.entries(db.items)) {
    if (!safeKey(name) || !record(item)) {
      errors.push(`物品 ${name} 无效`);
      continue;
    }
    for (const field of [
      "buyPrice",
      "sellPrice",
      "heat",
      "nutrientValue",
      "maxFertility",
    ])
      if (
        item[field] != null &&
        (!Number.isFinite(item[field]) || item[field] < 0)
      )
        errors.push(`${name}.${field} 必须是非负数`);
  }
  for (const [name, machine] of Object.entries(db.machines)) {
    if (!safeKey(name) || !record(machine)) {
      errors.push(`机器 ${name} 无效`);
      continue;
    }
    for (const field of ["heatCost", "heatSelf", "slots", "slotsRequired"])
      if (machine[field] != null && !Number.isFinite(machine[field]))
        errors.push(`${name}.${field} 必须是有限数值`);
  }
  const ids = new Set();
  db.recipes.forEach((r, index) => {
    if (!record(r)) {
      errors.push(`recipes[${index}] 无效`);
      return;
    }
    if (typeof r.id !== "string" || !r.id || ids.has(r.id))
      errors.push(`配方 ID 为空或重复：${r.id}`);
    ids.add(r.id);
    if (!db.machines[r.machine]) errors.push(`${r.id}: 未知机器 ${r.machine}`);
    for (const side of ["inputs", "outputs"]) {
      if (!record(r[side])) {
        errors.push(`${r.id}.${side} 必须是对象`);
        continue;
      }
      for (const [name, count] of Object.entries(r[side])) {
        if (!db.items[name] || !safeKey(name))
          errors.push(`${r.id}.${side}: 未知物品 ${name}`);
        if (!Number.isFinite(count) || count <= 0)
          errors.push(`${r.id}.${side}.${name}: 数量必须大于 0`);
      }
    }
    if (!(r.baseTime > 0) && !(r.nutrientCost > 0) && !r.customInputSlot)
      errors.push(`${r.id}: 缺少有效加工时间或营养规则`);
    if (r.baseTime != null && !Number.isFinite(r.baseTime))
      errors.push(`${r.id}: 加工时间无效`);
    for (const field of ["heatCost", "nutrientCost"])
      if (r[field] != null && (!Number.isFinite(r[field]) || r[field] < 0))
        errors.push(`${r.id}.${field} 必须是非负有限数值`);
    if (r.verification === "unverified") warnings.push(`${r.id}: 未核验规则`);
  });
  if (errors.length) throw new Error(errors.slice(0, 15).join("\n"));
  db.schemaVersion = 1;
  db.settings ??= {};
  return { db, warnings };
}

export function perMinute(value, unit) {
  value = Number(value);
  if (!(value > 0) || !Number.isFinite(value))
    throw new Error("目标产量必须是大于 0 的有限数值");
  const result =
    unit === "second" ? value * 60 : unit === "interval" ? 60 / value : value;
  if (!Number.isFinite(result) || result > 1e9)
    throw new Error("目标产量过大，请降低产量");
  return result;
}
