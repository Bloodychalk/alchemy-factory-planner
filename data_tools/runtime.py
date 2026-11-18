"""Fetch a pinned reference snapshot into a per-user cache, checking every file."""
from __future__ import annotations
import hashlib
import io
import json
import os
from pathlib import Path
import ssl
import sys
import tempfile
import threading
from urllib.request import Request, urlopen
from zipfile import ZipFile

_LOCK = threading.RLock()

def resources() -> Path:
    return Path(__file__).resolve().parents[1] / "web"

def user_directory() -> Path:
    if sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support"
    elif sys.platform == "win32":
        root = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    result = root / "AlchemyFactoryPlanner"
    result.mkdir(parents=True, exist_ok=True)
    return result

def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)

def download(url: str) -> bytes:
    import certifi
    request = Request(url, headers={"User-Agent": "Mozilla/5.0 AlchemyFactoryPlanner/0.1 (personal calculator)"})
    with urlopen(request, timeout=45, context=ssl.create_default_context(cafile=certifi.where())) as response:
        limit = 30_000_000
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError("参考文件超过大小限制")
        return data

class ReferenceCache:
    def __init__(self, directory: Path | None = None):
        self.manifest = json.loads((resources() / "upstream.json").read_text(encoding="utf-8"))
        self.root = (directory or user_directory()) / "reference" / self.manifest["commit"]

    def valid(self, name: str) -> bool:
        path = self.root / name
        return path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == self.manifest["files"][name]

    def get(self, name: str) -> bytes:
        if name not in self.manifest["files"]:
            raise ValueError("未登记的参考资源")
        with _LOCK:
            if not self.valid(name):
                self.prepare()
            if not self.valid(name):
                raise ValueError("参考文件校验失败")
            return (self.root / name).read_bytes()

    def prepare(self, source: Path | None = None) -> None:
        """A local reference checkout is accepted only if each pinned hash matches."""
        with _LOCK:
            if all(self.valid(n) for n in self.manifest["files"]):
                return
            if source is not None:
                for name, digest in self.manifest["files"].items():
                    data = (source / name).read_bytes()
                    if hashlib.sha256(data).hexdigest() != digest:
                        raise ValueError(f"本地参考版本不匹配：{name}")
                    atomic_write(self.root / name, data)
                return
            repo, commit = self.manifest["repository"], self.manifest["commit"]
            blob = download(f"https://codeload.github.com/{repo}/zip/{commit}")
            with ZipFile(io.BytesIO(blob)) as archive:
                prefix = archive.namelist()[0].split("/")[0] + "/"
                for name, digest in self.manifest["files"].items():
                    data = archive.read(prefix + name)
                    if hashlib.sha256(data).hexdigest() != digest:
                        raise ValueError(f"参考文件校验失败：{name}")
                    atomic_write(self.root / name, data)
