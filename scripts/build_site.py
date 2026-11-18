"""Build only the explicitly public web/ tree; never copy the workspace root."""
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]


def build() -> Path:
    source, destination = ROOT / "web", ROOT / "dist"
    if not (source / "index.html").is_file():
        raise ValueError("web/index.html is required")
    for path in source.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Symlinks are not permitted in public assets: {path}")
        if any(part.startswith(".") for part in path.relative_to(source).parts):
            raise ValueError(f"Hidden files are not permitted in public assets: {path}")
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(source, destination)
    (destination / ".nojekyll").touch()
    return destination


if __name__ == "__main__":
    try:
        result = build()
        print(f"Built {len(list(result.rglob('*')))} entries in {result}")
    except (ValueError, OSError) as error:
        print(f"Build failed: {error}", file=sys.stderr)
        raise SystemExit(1)
