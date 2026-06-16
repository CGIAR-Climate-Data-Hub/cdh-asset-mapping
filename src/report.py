"""
report.py
---------
Generates optional Markdown export at outputs/CDH_Asset_Mapping_Report.md
with all statistics computed from data/normalized/assets.json.
"""

from pathlib import Path

from report_common import build_markdown_report, compute_stats, load, pct

ROOT = Path(__file__).parent.parent
OUT_PATH = ROOT / "outputs" / "CDH_Asset_Mapping_Report.md"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    assets, ml = load()
    s = compute_stats(assets, ml)
    print(f"Loaded {s['total']} assets from {s['n_centres']} centres")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    text = build_markdown_report(assets, s)
    with open(OUT_PATH, "w") as f:
        f.write(text)
    print(f"Written: {OUT_PATH}")

    # Print key stats for verification
    print(f"\nKey stats:")
    print(f"  Total assets:    {s['total']}")
    print(f"  Hub-funded:      {s['hub_total']} ({pct(s['hub_total'], s['total'])}%)")
    print(f"  Top domains:     {s['domain_counts'].most_common(3)}")
    print(f"  Africa/Global:   {s['geo_counts'].get('Africa')} / {s['geo_counts'].get('Global')}")


if __name__ == "__main__":
    main()
