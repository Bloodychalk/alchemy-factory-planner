"""Convert public Wiki constants to the reference schema without executing JS."""
from __future__ import annotations
from datetime import datetime, timezone
import copy
import json
import re
from urllib.parse import urljoin, urlparse
from .runtime import download

BASE = "https://alchemy-factory-codex.com"

def normalized(name: str) -> str:
    return name.strip().lower().replace("ˈ", "'").replace("’", "'")

def extract_arrays(source: str) -> tuple[list, list]:
    arrays = [json.loads(raw) for raw in re.findall(r"JSON\.parse\(`(.*?)`\)", source, re.S)]
    if len(arrays) < 2 or not all(isinstance(a, list) for a in arrays[:2]):
        raise ValueError("Wiki 数据格式发生变化，保留原资料")
    return arrays[0], arrays[1]

def fetch_source() -> tuple[str, str]:
    page = download(BASE + "/production-planner/").decode()
    script = re.search(r'src="([^"]*ProductionPlannerPage[^\"]+\.js)"', page)
    if not script:
        raise ValueError("没有找到 Wiki 规划器数据入口")
    url = urljoin(BASE, script.group(1))
    code = download(url).decode()
    module = re.search(r'from["\']([^"\']*cost-calculator[^"\']*\.js)["\']', code)
    if not module:
        raise ValueError("没有找到 Wiki 配方模块")
    data_url = urljoin(url, module.group(1))
    if urlparse(data_url).netloc != urlparse(BASE).netloc:
        raise ValueError("Wiki 数据入口指向未知域名")
    return download(data_url).decode(), data_url

def synchronize(database: dict, source: str | None = None, source_url: str | None = None) -> tuple[dict, int, list[str]]:
    if source is None:
        source, source_url = fetch_source()
    items, recipes = extract_arrays(source)
    db = copy.deepcopy(database)
    mapping = {normalized(k): k for k in db["items"]}
    mapping["wagon"] = "Cart" if "Cart" in db["items"] else "Wagon"
    warnings = []
    for entry in items:
        name = mapping.get(normalized(entry["name"]))
        if name is None:
            name = entry["name"].replace("'", "ˈ")
            mapping[normalized(entry["name"])] = name
            # Preserve reference icon identifiers; new items use the generic icon.
            db["items"][name] = {"id": 0, "category": "Wiki", "sourceId": entry["id"]}
        target = db["items"][name]
        for origin, destination in [("cost", "buyPrice"),("price","sellPrice"),("heat_value","heat"),("nutrient_value","nutrientValue"),("nutrients_per_seconds","maxFertility"),("cauldron_cost","cauldronCost"),("cauldron_target","cauldronTarget"),("cauldron_coef","cauldronMulti")]:
            if entry.get(origin) is not None:
                target[destination] = entry[origin]
        target["wikiId"] = entry["id"]
        if entry.get("id_num") is not None:
            target["logicId"] = entry["id_num"]
        target["canCauldronTarget"] = bool(entry.get("cauldron_coef"))
        if entry.get("base_cost") is not None:
            target["baseCost"] = entry["base_cost"] / (entry.get("fraction_num", 1) if target.get("maxStack", 0) < 0 else 1)
            efficiency = entry.get("cauldron_cost", 0) / (entry.get("cauldron_target") or 1)
            if entry["base_cost"] > 0 and efficiency > 0:
                target["paradoxTime"] = 1500 / (entry["base_cost"] * efficiency)
    machine_map = {normalized(k): k for k in db["machines"]}
    updated = 0
    for r in recipes:
        machine = machine_map.get(normalized(r["crafted_in"]))
        # These entries are compact examples of dynamic rules, not replacements.
        if machine == "Cauldron":
            continue
        if machine == "World Tree Nursery":
            nutrients = sum(float(x["count"]) for x in r["inputs"] if x["name"].lower() == "nutrient")
            for target in db["recipes"]:
                if target["machine"] == machine and nutrients:
                    target.update(nutrientCost=nutrients, baseTime=float(r["time"]), wikiId=r["id"])
                    updated += 1
            continue
        if machine == "Nursery":
            machine = "Seed Plot"
        if machine is None:
            warnings.append(f"未知机器：{r['crafted_in']}")
            continue
        try:
            ins = {mapping[normalized(x["name"])]: float(x["count"]) for x in r["inputs"]}
            outs = {mapping[normalized(x["name"])]: float(x["count"]) * float(x.get("percentage", 100)) / 100 for x in r["outputs"]}
        except KeyError as exc:
            warnings.append(f"{r['id']}：未识别物品 {exc}")
            continue
        matches = [x for x in db["recipes"] if x["machine"] == machine and set(x["inputs"]) == set(ins) and set(x["outputs"]) == set(outs)]
        if matches:
            for target in matches:
                target.update(inputs=ins, outputs=outs, baseTime=float(r["time"]), wikiId=r["id"])
        else:
            db["recipes"].append({"id": "WIKI_" + r["id"], "machine": machine, "inputs": ins, "outputs": outs, "baseTime": float(r["time"]), "wikiId": r["id"]})
        updated += 1
    db.setdefault("metadata", {}).update(wikiSyncedAt=datetime.now(timezone.utc).isoformat(), wikiSource=source_url or BASE + "/production-planner/", wikiRecipes=len(recipes), wikiUpdated=updated, wikiWarnings=warnings, dynamicRulesSource="Pinned reference engine; dynamic mechanism definitions preserved")
    return db, updated, warnings
