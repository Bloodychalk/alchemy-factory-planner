export const STORAGE_PREFIX = "alchemy-factory-planner:v1:";
export const storage = {
  get(key, fallback = null) {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_PREFIX + key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};
let bridgeResolve;
const bridgeReady = new Promise((resolve) => {
  bridgeResolve = resolve;
});
window.addEventListener(
  "pywebviewready",
  () => bridgeResolve(window.pywebview.api),
  { once: true },
);
export async function desktopAPI() {
  if (!window.pywebview && !window.ALCHEMY_DESKTOP) return null;
  if (window.pywebview?.api) return window.pywebview.api;
  return Promise.race([
    bridgeReady,
    new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
}
export async function saveFile(name, text, type = "application/json") {
  const api = await desktopAPI();
  if (api) {
    const result = await api.save_file(name, text);
    if (!result.ok && !result.cancelled) throw new Error(result.error);
    return;
  }
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
