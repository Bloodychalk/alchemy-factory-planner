"""Build only our host and adapters; reference code stays in the user's cache."""
import os
from pathlib import Path
import subprocess
import sys
ROOT = Path(__file__).resolve().parents[1]
command = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--windowed", "--name", "AlchemyFactoryPlanner", "--paths", str(ROOT), "--add-data", f"{ROOT / 'web'}{os.pathsep}web", "--distpath", str(ROOT / "desktop-dist"), "--workpath", str(ROOT / "build" / "desktop"), "--specpath", str(ROOT / "build"), str(ROOT / "desktop_entry.py")]
if sys.platform == "darwin":
    command += ["--osx-bundle-identifier", "io.github.bloodychalk.alchemy-factory-planner"]
subprocess.run(command, cwd=ROOT, check=True)
