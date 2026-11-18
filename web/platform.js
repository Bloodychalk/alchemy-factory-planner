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
export async function saveFile(name, text, type = "application/json") {
  const blob = new Blob([text], { type });
  if (blob.size > 20_000_000)
    throw new Error("文件超过20 MB，无法保存为可重新导入的方案");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
