"""
export_dashboard_data.py
------------------------
Copy normalized asset inventory into docs/ so static GitHub Pages dashboard
can fetch it client-side.
"""

from pathlib import Path
import shutil

ROOT = Path(__file__).parent.parent
SOURCE = ROOT / "data" / "normalized" / "assets.json"
DOCS_DATA = ROOT / "docs" / "data"
TARGET = DOCS_DATA / "assets.json"


def main():
    DOCS_DATA.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE, TARGET)
    print(f"Copied: {SOURCE} -> {TARGET}")


if __name__ == "__main__":
    main()
