"""Check static asset paths for deployment beneath a GitHub Pages project URL."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import sys

ROOT = Path(__file__).resolve().parents[1]


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in {"src", "href"} and value:
                self.urls.append(value)


def check(site: Path) -> list[str]:
    errors = []
    if not (site / "index.html").is_file():
        return ["Missing index.html"]
    for html in site.rglob("*.html"):
        parser = References()
        parser.feed(html.read_text(encoding="utf-8"))
        for url in parser.urls:
            parts = urlsplit(url)
            if parts.scheme or parts.netloc or not parts.path:
                continue
            if parts.path.startswith("/"):
                errors.append(f"{html.name}: use relative URLs for project Pages: {url}")
                continue
            target = (html.parent / unquote(parts.path)).resolve()
            if not target.is_relative_to(site.resolve()):
                errors.append(f"{html.name}: asset escapes the public directory: {url}")
                continue
            if target.is_dir():
                target /= "index.html"
            if not target.is_file():
                errors.append(f"{html.name}: missing local resource: {url}")
    for forbidden in ("research", ".git", ".env", "modification-plan.md"):
        if list(site.rglob(forbidden)):
            errors.append(f"Private/local material found in output: {forbidden}")
    return errors


if __name__ == "__main__":
    site = ROOT / "dist"
    errors = check(site)
    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        raise SystemExit(1)
    print("Static site check passed: index, relative asset links, publication boundary.")
