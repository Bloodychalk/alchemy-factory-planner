import { readLiteral, validateDataset } from "./data.js";
import { patchSource } from "./patches.js";
const manifest = await fetch(new URL("./upstream.json", import.meta.url)).then(
  (r) => {
    if (!r.ok) throw new Error("无法加载参考版本清单");
    return r.json();
  },
);
const memory = new Map();
export { manifest };
export async function asset(name) {
  if (memory.has(name)) return memory.get(name);
  const expected = manifest.files[name];
  if (!expected) throw new Error(`未登记的参考文件：${name}`);
  let data;
  const url = manifest.baseUrl + name;
  const cache =
    "caches" in window
      ? await caches.open("alchemy-factory-planner-reference-v1")
      : null;
  let response = await cache?.match(url);
  if (!response) {
    response = await fetch(url);
    if (!response.ok)
      throw new Error(`无法下载参考文件 ${name}（${response.status}）`);
  }
  data = new Uint8Array(await response.arrayBuffer());
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== expected) {
    await cache?.delete(url);
    throw new Error(`参考文件校验失败：${name}`);
  }
  await cache?.put(url, new Response(data));
  memory.set(name, data);
  return data;
}
export async function textAsset(name) {
  return new TextDecoder().decode(await asset(name));
}
export async function loadReference() {
  const [data, engine, i18n, state, cauldron] = await Promise.all(
    [
      "alchemy_db.js",
      "alchemy_calc_engine.js",
      "alchemy_i18n.js",
      "alchemy_state.js",
      "alchemy_cauldron.js",
    ].map((name) => textAsset("js/" + name)),
  );
  const db = readLiteral(data, "window.ALCHEMY_DB =");
  const translations = readLiteral(i18n, "window.ALCHEMY_I18N =");
  const settings = readLiteral(state, "const DEFAULT_SETTINGS =");
  db.settings = settings;
  db.metadata = {
    repository: manifest.repository,
    commit: manifest.commit,
    source: "参考计算器数据库；Wiki 可另行校准",
  };
  const rules = cauldron
    .slice(
      cauldron.indexOf("function getCauldronStats("),
      cauldron.indexOf("async function runCauldronSimulationType0("),
    )
    .replace(
      "DB.items[name].cauldronTarget !== undefined",
      "DB.items[name].cauldronTarget !== undefined && DB.items[name].canCauldronTarget !== false",
    )
    .replace(
      "id: DB.items[name].id || 3000",
      "id: DB.items[name].logicId ?? DB.items[name].id ?? 3000",
    );
  return {
    db: validateDataset(db).db,
    translations,
    engine: patchSource("alchemy_calc_engine.js", engine),
    rules,
  };
}

const scriptTag = (text) =>
  `<script>${text.replace(/<\/script/gi, "<\\/script")}</script>`;
export async function graphDocument(payload, progress = () => {}) {
  let html = await textAsset("index.html");
  const names = [
    ...html.matchAll(/<script\s+src="([^"]+)"[^>]*><\/script>/g),
  ].map((m) => m[1]);
  const sources = new Map(
    await Promise.all(
      names.map(async (name) => [
        name,
        patchSource(name, await textAsset(name)),
      ]),
    ),
  );
  progress("准备图形资源");
  const imageNames = new Set(["img/item0.png"]);
  for (const step of payload.plan.steps) {
    for (const item of [
      ...Object.keys(step.recipe.inputs),
      ...Object.keys(step.recipe.outputs),
    ]) {
      const name = `img/item${payload.db.items[item]?.id ?? 0}.png`;
      if (manifest.files[name]) imageNames.add(name);
    }
    const name = `img/machines/${step.machine.toLowerCase().replaceAll(" ", "-")}.png`;
    if (manifest.files[name]) imageNames.add(name);
  }
  const images = Object.fromEntries(
    await Promise.all(
      [...imageNames].map(async (name) => {
        try {
          const bytes = await asset(name);
          let str = "";
          bytes.forEach((v) => {
            str += String.fromCharCode(v);
          });
          return [name, "data:image/png;base64," + btoa(str)];
        } catch {
          return [name, ""];
        }
      }),
    ),
  );
  html = html
    .replace(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/g, "")
    .replace(/<link[^>]+(?:canonical|alternate|icon)[^>]*>/g, "");
  html = html.replace(
    /<link rel="stylesheet" href="style.css">/,
    `<style>${await textAsset("style.css")}</style>`,
  );
  html = html.replace(/<script\s+src="([^"]+)"[^>]*><\/script>/g, (_, name) =>
    scriptTag(sources.get(name)),
  );
  html = html.replace(
    "<head>",
    "<head>" +
      scriptTag(
        "const referenceStore=new Map();const referenceStorage={getItem:k=>referenceStore.get(k)??null,setItem:(k,v)=>referenceStore.set(k,String(v)),removeItem:k=>referenceStore.delete(k),clear:()=>referenceStore.clear()};",
      ),
  );
  const serialized = JSON.stringify({ payload, images }).replaceAll(
    "<",
    "\\u003c",
  );
  const bridge = `
    const referenceBridge = ${serialized};
    window.onload = function() {
      const p = referenceBridge.payload; DB = p.db; DB.settings = {...DEFAULT_SETTINGS,...p.db.settings,...p.plan.settings};
      ALCHEMY_DB = DB; ALCHEMY_I18N.enabled = true;
      Object.values(p.plan.graph.nodes).forEach(n=>{const r=n.resolved.recipe;if(!DB.recipes.some(x=>x.id===r.id))DB.recipes.push(r);DB.machines[r.machine]??={buildCost:{}};});
      const originalGetRates=plannerGetNodeRates;
      plannerGetNodeRates=function(node){return node.resolved||originalGetRates(node);};
      renderPlannerSummary=function(){
        const panel=ensurePlannerSummaryPanel();panel.replaceChildren();
        for(const text of ['净交付 '+p.plan.desired.toFixed(2)+' /分钟', '持续采购 '+p.plan.cost.toFixed(2)+' 铜/分钟', '生产与供热设备 '+p.plan.installed+' 台', '加工热耗 '+p.plan.heat.toFixed(2)+' /秒']){const row=document.createElement('div');row.style.padding='5px 12px';row.textContent=text;panel.appendChild(row);}
      };
      document.querySelectorAll('header, #update-banner, #view-calc, #view-cauldron, #view-help, #view-db').forEach(e => e.style.display='none');
      const view=document.getElementById('view-planner'); view.style.display='block';
      initPlannerPage();
      plannerState.nodes={}; plannerState.edges={}; plannerState._nodeSeq=0; plannerState._edgeSeq=0;
      Object.assign(plannerState, p.plan.graph);
      const rootIds=Object.values(plannerState.nodes).filter(n=>n.resolved.outputsPerMachine.length===0).map(n=>n.id);
      if(!p.plan.layoutSaved)_plannerLayoutImportedGraph(Object.keys(plannerState.nodes),rootIds,0,0);
      renderPlanner(); savePlannerState(); requestAnimationFrame(()=>plannerFitToView());
      const localizeImages = () => {
        document.querySelectorAll('img[src^="img/"]').forEach(img=>{const n=img.getAttribute('src'); if(referenceBridge.images[n]) img.src=referenceBridge.images[n];else img.style.display='none';});
        document.querySelectorAll('.planner-port-name').forEach(el=>{const translated=ALCHEMY_I18N.items[el.textContent];if(translated&&translated!==el.textContent)el.textContent=translated;});
        document.querySelectorAll('input[data-mc-for]').forEach(el=>{const n=plannerState.nodes[el.dataset.mcFor];if(!n)return;el.readOnly=true;el.disabled=true;if(n.recipeId.startsWith('boundary-'))el.closest('.planner-machine-count-row').style.display='none';else{el.value=Math.ceil(n.machineCount-1e-7);el.title='建造台数；理论负载 '+n.machineCount.toFixed(3)+' 台';}});
      };
      new MutationObserver(localizeImages).observe(document.body,{subtree:true,childList:true}); localizeImages();
      document.querySelectorAll('.planner-port-dot').forEach(el=>el.style.pointerEvents='none');
      document.getElementById('planner-svg-layer')?.addEventListener('click',event=>event.stopImmediatePropagation(),true);
      document.getElementById('planner-canvas').addEventListener('contextmenu',event=>{event.preventDefault();event.stopImmediatePropagation();},true);
      window.addEventListener('keydown',event=>{if(['Delete','Backspace'].includes(event.key)||(event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();event.stopImmediatePropagation();}},true);
      window.addEventListener('message', event => {if(event.source!==parent)return; if(event.data?.type==='export-layout')parent.postMessage({type:'layout',graph:JSON.parse(JSON.stringify(plannerState))},'*');});
      parent.postMessage({type:'graph-ready'},'*');
    };`;
  const style = `<style>html,body{height:100%;background:#14231f}header,#update-banner{display:none!important}main{padding:0!important;max-width:none!important}#view-planner{height:100vh!important}#planner-canvas{height:100vh!important;border:0}#view-planner>.planner-toolbar{display:none!important}#planner-summary-panel{font-size:11px}.planner-node input{pointer-events:none}.planner-node button{display:none!important}</style>`;
  return html
    .replace("</head>", style + "</head>")
    .replace("</body>", scriptTag(bridge) + "</body>");
}
