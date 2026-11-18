from __future__ import annotations
import argparse
import base64
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import sys
from urllib.parse import urlsplit
from .runtime import ReferenceCache, atomic_write, resources, user_directory
from .wiki import synchronize

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlsplit(self.path).path in {"/", "/index.html"}:
            content = (resources() / "index.html").read_text(encoding="utf-8").replace("<head>", "<head><script>window.ALCHEMY_DESKTOP=true;</script>", 1).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        else:
            super().do_GET()
    def log_message(self, *args):
        pass

class Api:
    def __init__(self):
        self._window = None
        self._cache = ReferenceCache()
        self._directory = user_directory()

    def runtime_asset(self, name):
        try:
            return {"ok": True, "data": base64.b64encode(self._cache.get(name)).decode()}
        except Exception as error:
            return {"ok": False, "error": f"首次准备需要联网，或参考文件不可用：{error}"}

    def save_file(self, filename, text):
        import webview
        try:
            if not isinstance(text, str) or len(text) > 20_000_000:
                raise ValueError("保存内容过大")
            target = self._window.create_file_dialog(webview.FileDialog.SAVE, save_filename=Path(filename).name)
            if not target:
                return {"ok": False, "cancelled": True}
            path = target[0] if isinstance(target, (tuple, list)) else target
            atomic_write(Path(path), text.encode())
            return {"ok": True}
        except Exception as error:
            return {"ok": False, "error": str(error)}

    def autosave(self, text):
        try:
            if len(text) > 20_000_000:
                raise ValueError("方案过大")
            json.loads(text)
            atomic_write(self._directory / "last-plan.json", text.encode())
            return {"ok": True}
        except Exception as error:
            return {"ok": False, "error": str(error)}

    def restore(self):
        path = self._directory / "last-plan.json"
        return {"ok": True, "data": path.read_text(encoding="utf-8") if path.exists() else ""}

    def save_dataset(self, text):
        try:
            if len(text) > 20_000_000:
                raise ValueError("资料过大")
            json.loads(text)
            atomic_write(self._directory / "dataset.json", text.encode())
            return {"ok": True}
        except Exception as error:
            return {"ok": False, "error": str(error)}

    def load_dataset(self):
        path = self._directory / "dataset.json"
        return {"ok": True, "data": path.read_text(encoding="utf-8") if path.exists() else ""}

    def sync_wiki(self, text):
        try:
            db, count, warnings = synchronize(json.loads(text))
            result = json.dumps(db, ensure_ascii=False)
            atomic_write(self._directory / "dataset.json", result.encode())
            return {"ok": True, "data": result, "updated": count, "warnings": warnings}
        except Exception as error:
            return {"ok": False, "error": str(error)}

def main():
    # Windows terminals can default to cp1252. File formats and diagnostics are UTF-8.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description="炼金工厂产线计算器")
    parser.add_argument("--prepare", action="store_true", help="下载并校验本机离线参考资料")
    parser.add_argument("--reference", type=Path, help="使用已下载且版本匹配的参考源码")
    args = parser.parse_args()
    if args.prepare:
        cache = ReferenceCache()
        cache.prepare(args.reference)
        print("离线参考资料已准备：", cache.root)
        return
    import webview
    api = Api()
    handler = functools.partial(Handler, directory=str(resources()))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/"
    window = webview.create_window("炼金工厂 · 产线计算器", url, js_api=api, width=1360, height=900, min_size=(880, 650), background_color="#F4F6F1")
    api._window = window
    try:
        webview.start(gui="edgechromium" if sys.platform == "win32" else None, private_mode=False, storage_path=str(user_directory() / "webview"))
    finally:
        server.shutdown()

if __name__ == "__main__":
    main()
