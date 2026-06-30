"""
figures.py
----------
Generates all report figures from data/normalized/assets.json.

Usage:
    python src/figures.py

Output files in outputs/figures/:
    fig1_assets_per_centre.png
    fig2_climate_domains.png
    fig3_asset_types.png
    fig4_geographic_coverage.png
    fig5_heatmap_centre_domain.png
"""

import json
from collections import Counter
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

from report_common import display_nominator, figure1_centre_label

ROOT        = Path(__file__).parent.parent
ASSETS_PATH = ROOT / "data" / "normalized" / "assets.json"
OUT_DIR     = ROOT / "outputs" / "figures"

# ---------------------------------------------------------------------------
# Brand colours
# ---------------------------------------------------------------------------
PROGRAM_BLUE    = "#1955A6"
PROGRAM_BLUE_LT = "#63A9FE"
CGIAR_GREEN     = "#033529"
TEAL            = "#17F1BD"
GREY_LIGHT      = "#E8EDF3"
GREY_MED        = "#9AAFCA"

HUB_FUNDED  = {"Alliance", "IITA", "ILRI", "IFPRI", "IWMI", "WorldFish"}

# Domain colour palette (consistent across fig2 and fig5)
DOMAIN_COLOURS = {
    "Adaptation Analytics":             "#1955A6",
    "Hazard":                           "#63A9FE",
    "Multi-domain":                     "#9AAFCA",
    "Exposure":                         "#17F1BD",
    "Mitigation":                       "#033529",
    "Hazard / Climate Services":        "#4A90D9",
    "Sensitivity":                      "#F4B942",
    "Sensitivity / Adaptation Analytics":"#E8843A",
    "Adaptation Analytics / Mitigation":"#2E7D52",
    "Climate Policy / Finance":         "#8B5CF6",
    "Adaptive Capacity":                "#EC4899",
    "Not specified":                    "#CCCCCC",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def savefig(fig, name: str):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    fig.savefig(path, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"  Saved: {path.name}")


def bar_colours(labels, funded_set=None):
    """Return bar colours: dark blue for hub-funded, light blue otherwise."""
    if funded_set is None:
        return [PROGRAM_BLUE] * len(labels)
    return [PROGRAM_BLUE if l in funded_set else PROGRAM_BLUE_LT for l in labels]


def _heatmap(ax, matrix, row_labels, col_labels, zero_dot=False):
    """Shared compact heatmap style for the centre×domain and domain×geography
    matrices. Column labels are horizontal (use \\n for two lines) so they never
    overlap; cells are rectangular (aspect='auto') to keep height down."""
    from matplotlib.colors import LinearSegmentedColormap
    cmap = LinearSegmentedColormap.from_list(
        "cdh_blue", ["#FFFFFF", "#DCEBFB", PROGRAM_BLUE_LT, PROGRAM_BLUE])
    mx = max(int(matrix.max()), 1)
    ax.imshow(matrix, aspect="auto", cmap=cmap, vmin=0, vmax=mx)

    nrows, ncols = matrix.shape
    for ri in range(nrows):
        for ci in range(ncols):
            v = int(matrix[ri, ci])
            if v == 0:
                if zero_dot:
                    ax.text(ci, ri, "•", ha="center", va="center",
                            fontsize=9, color="#D98273")
            else:
                col = "white" if v >= mx * 0.5 else CGIAR_GREEN
                ax.text(ci, ri, str(v), ha="center", va="center",
                        fontsize=9, color=col, fontweight="bold")

    ax.set_xticks(range(ncols))
    ax.set_xticklabels(col_labels, rotation=0, ha="center", fontsize=7.8,
                       color="#3D4F5C")
    ax.xaxis.set_ticks_position("top")
    ax.xaxis.set_label_position("top")
    ax.set_yticks(range(nrows))
    ax.set_yticklabels(row_labels, fontsize=8.5, color="#3D4F5C")
    # White gutters between cells
    ax.set_xticks(np.arange(-0.5, ncols), minor=True)
    ax.set_yticks(np.arange(-0.5, nrows), minor=True)
    ax.grid(which="minor", color="white", linewidth=2.5)
    ax.tick_params(which="both", length=0)
    for spine in ax.spines.values():
        spine.set_visible(False)


# ---------------------------------------------------------------------------
# Figure 1 — Assets per centre
# ---------------------------------------------------------------------------
# Segment palette for nominator contributions (cycled; identity incidental,
# no legend — the interactive dashboard shows who on hover).
SEG_PALETTE = ["#1955A6", "#1F8A70", "#E0A11B", "#63A9FE", "#C2691C", "#17F1BD",
               "#7D8CC4", "#8B5CF6", "#2E7D52", "#EC4899", "#5C6B73", "#AE6C7A",
               "#4A90D9", "#F4B942"]


def fig1_assets_per_centre(assets):
    from collections import defaultdict
    by_centre = defaultdict(lambda: defaultdict(int))
    totals = Counter()
    for a in assets:
        c = a["centre"]
        nm = display_nominator(a.get("nominator"))
        by_centre[c][nm] += 1
        totals[c] += 1
    # Ascending so the largest centre sits at the top of the horizontal bars.
    centres = sorted(totals, key=totals.get)

    fig, ax = plt.subplots(figsize=(8, 4.6))
    for yi, c in enumerate(centres):
        left = 0
        for i, (nm, cnt) in enumerate(sorted(by_centre[c].items(), key=lambda x: -x[1])):
            ax.barh(yi, cnt, left=left, height=0.66,
                    color=SEG_PALETTE[i % len(SEG_PALETTE)],
                    edgecolor="white", linewidth=0.8, zorder=2)
            left += cnt
        ax.text(left + max(totals.values()) * 0.012, yi, str(left),
                va="center", fontsize=9, color="#333333")

    ax.set_yticks(range(len(centres)))
    ax.set_yticklabels([figure1_centre_label(c) for c in centres], fontsize=9)
    ax.set_xlabel("Number of assets (bar split by nominator)", fontsize=10)
    ax.set_xlim(0, max(totals.values()) * 1.15)
    ax.tick_params(axis="x", labelsize=9)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.grid(axis="x", color=GREY_LIGHT, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    fig.tight_layout()
    savefig(fig, "fig1_assets_per_centre.png")


# ---------------------------------------------------------------------------
# Figure 2 — Domain distribution
# ---------------------------------------------------------------------------
def fig2_climate_domains(assets):
    counts = Counter(a["domain_norm"] for a in assets
                     if a["domain_norm"] != "Not specified")
    domains = [d for d, _ in counts.most_common()]
    values  = [counts[d] for d in domains]
    colours = [DOMAIN_COLOURS.get(d, GREY_MED) for d in domains]

    fig, ax = plt.subplots(figsize=(8, 4.4))
    bars = ax.barh(domains[::-1], values[::-1], color=colours[::-1],
                   height=0.65, edgecolor="none")
    ax.bar_label(bars, padding=4, fontsize=9, color="#333333")
    ax.set_xlabel("Number of assets", fontsize=10)
    ax.set_xlim(0, max(values) * 1.18)
    ax.tick_params(axis="y", labelsize=9)
    ax.tick_params(axis="x", labelsize=9)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.grid(axis="x", color=GREY_LIGHT, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)

    # Notes (exclusions, domain definitions) live in the report caption, not the plot.
    fig.tight_layout(rect=[0, 0, 1, 0.97])
    savefig(fig, "fig2_climate_domains.png")


# ---------------------------------------------------------------------------
# Figure 3 — Asset types
# ---------------------------------------------------------------------------
def fig3_asset_types(assets):
    counts = Counter(a["type_norm"] for a in assets if a["type_norm"])
    labels  = [t for t, _ in counts.most_common()]
    values  = [counts[t] for t in labels]
    pct     = [v / sum(values) * 100 for v in values]
    colours = [PROGRAM_BLUE, PROGRAM_BLUE_LT, TEAL, GREY_MED][:len(labels)]

    fig, ax = plt.subplots(figsize=(8, 3.0))
    bars = ax.barh(labels[::-1], values[::-1], color=colours[::-1],
                   height=0.55, edgecolor="none")
    for bar, p in zip(bars, pct[::-1]):
        ax.text(bar.get_width() + 0.3, bar.get_y() + bar.get_height() / 2,
                f"{bar.get_width():.0f}  ({p:.0f}%)", va="center", fontsize=9)
    ax.set_xlabel("Number of assets", fontsize=10)
    ax.set_xlim(0, max(values) * 1.28)
    ax.tick_params(axis="y", labelsize=9)
    ax.tick_params(axis="x", labelsize=9)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.grid(axis="x", color=GREY_LIGHT, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    fig.tight_layout(rect=[0, 0, 1, 0.95])
    savefig(fig, "fig3_asset_types.png")


# ---------------------------------------------------------------------------
# Figure 4 — Geographic coverage
# ---------------------------------------------------------------------------
def fig4_geographic_coverage(assets):
    counts = Counter(a["geo_norm"] for a in assets
                     if a["geo_norm"] != "Not specified")
    geo_order = ["Africa", "Global", "Asia / South & SE Asia",
                 "Latin America & Caribbean", "Multi-regional"]
    labels = [g for g in geo_order if g in counts]
    values = [counts[g] for g in labels]
    colours = [PROGRAM_BLUE, PROGRAM_BLUE_LT, TEAL, CGIAR_GREEN, GREY_MED][:len(labels)]

    fig, ax = plt.subplots(figsize=(8, 3.0))
    bars = ax.barh(labels[::-1], values[::-1], color=colours[::-1],
                   height=0.6, edgecolor="none")
    ax.bar_label(bars, padding=4, fontsize=9, color="#333333")
    ax.set_xlabel("Number of assets", fontsize=10)
    ax.set_xlim(0, max(values) * 1.18)
    ax.tick_params(axis="y", labelsize=9)
    ax.tick_params(axis="x", labelsize=9)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.grid(axis="x", color=GREY_LIGHT, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)

    # Exclusion note lives in the report caption, not the plot.
    fig.tight_layout(rect=[0, 0, 1, 0.97])
    savefig(fig, "fig4_geographic_coverage.png")


# ---------------------------------------------------------------------------
# Figure 5 — Heatmap: centre × domain
# ---------------------------------------------------------------------------
def fig5_heatmap(assets):
    # Only canonical single-domain categories for the heatmap
    HEATMAP_DOMAINS = [
        "Adaptation Analytics",
        "Hazard",
        "Multi-domain",
        "Exposure",
        "Mitigation",
        "Hazard / Climate Services",
        "Sensitivity",
        "Adaptive Capacity",
    ]

    centres_ordered = [
        "AfricaRice", "Alliance", "CIFOR_ICRAF", "CIP",
        "ICRISAT", "IFPRI", "IITA", "ILRI", "IRRI", "IWMI", "WorldFish",
    ]

    # Build matrix
    matrix = np.zeros((len(centres_ordered), len(HEATMAP_DOMAINS)), dtype=int)
    for a in assets:
        if a["domain_norm"] in HEATMAP_DOMAINS and a["centre"] in centres_ordered:
            ri = centres_ordered.index(a["centre"])
            ci = HEATMAP_DOMAINS.index(a["domain_norm"])
            matrix[ri, ci] += 1

    SHORT = {
        "Adaptation Analytics": "Adapt.\nAnalytics", "Hazard": "Hazard",
        "Multi-domain": "Multi-\ndomain", "Exposure": "Exposure",
        "Mitigation": "Mitigation", "Hazard / Climate Services": "Hazard /\nClim. Svc",
        "Sensitivity": "Sensitivity", "Adaptive Capacity": "Adaptive\nCapacity",
    }
    fig, ax = plt.subplots(figsize=(8.0, 4.6))
    _heatmap(ax, matrix, [c.replace("_", "-") for c in centres_ordered],
             [SHORT.get(d, d) for d in HEATMAP_DOMAINS], zero_dot=False)
    fig.tight_layout()
    savefig(fig, "fig5_heatmap_centre_domain.png")


# ---------------------------------------------------------------------------
# Figure 6 — Domain × geography gap matrix (where are we strong / weak?)
# ---------------------------------------------------------------------------
def fig6_gap_matrix(assets):
    DOMAINS = [
        "Hazard", "Hazard / Climate Services", "Exposure", "Sensitivity",
        "Adaptive Capacity", "Adaptation Analytics", "Mitigation",
        "Climate Policy / Finance", "Multi-domain",
    ]
    GEOS = ["Africa", "Asia / South & SE Asia",
            "Latin America & Caribbean", "Global", "Multi-regional"]

    matrix = np.zeros((len(DOMAINS), len(GEOS)), dtype=int)
    for a in assets:
        d, g = a["domain_norm"], a["geo_norm"]
        if d in DOMAINS and g in GEOS:
            matrix[DOMAINS.index(d), GEOS.index(g)] += 1

    GEO_SHORT = {
        "Africa": "Africa", "Asia / South & SE Asia": "Asia /\nSE Asia",
        "Latin America & Caribbean": "Lat. Am. /\nCaribbean", "Global": "Global",
        "Multi-regional": "Multi-\nregional",
    }
    fig, ax = plt.subplots(figsize=(7.6, 4.4))
    _heatmap(ax, matrix, DOMAINS, [GEO_SHORT.get(g, g) for g in GEOS],
             zero_dot=True)
    fig.tight_layout()
    savefig(fig, "fig6_gap_matrix.png")


# ---------------------------------------------------------------------------
# Figure 7 — Priority quadrant: readiness × reuse, sized by decision relevance
# ---------------------------------------------------------------------------
def fig7_priority_quadrant(assets):
    rng = np.random.default_rng(42)
    access_col = {"Open": TEAL, "Restricted": "#E8843A", "Unknown": GREY_MED}

    fig, ax = plt.subplots(figsize=(7.5, 6))
    plotted = {"Open": False, "Restricted": False, "Unknown": False}
    for a in assets:
        sc = a.get("score_components", {})
        x, y = sc.get("technical_readiness"), sc.get("reuse_potential")
        if x is None or y is None:
            continue
        acc = a.get("access_norm", "Unknown")
        # Jitter discrete ordinal values so overlapping points separate.
        jx = x + rng.normal(0, 0.025)
        jy = y + rng.normal(0, 0.025)
        # Uniform marker size: position (readiness × reuse) and colour (access)
        # carry the signal. Decision relevance is near-constant ("High" for most
        # assets), so encoding it as size added clutter, not information.
        ax.scatter(jx, jy, s=90, alpha=0.6,
                   color=access_col.get(acc, GREY_MED),
                   edgecolor="white", linewidth=0.6,
                   label=acc if not plotted[acc] else None, zorder=3)
        plotted[acc] = True

    ax.axvline(0.7, color=GREY_MED, lw=0.8, ls="--", zorder=1)
    ax.axhline(0.7, color=GREY_MED, lw=0.8, ls="--", zorder=1)
    ax.set_xlim(0.1, 1.08)
    ax.set_ylim(0.1, 1.08)
    ax.set_xlabel("Technical readiness →", fontsize=10)
    ax.set_ylabel("Reuse potential →", fontsize=10)
    ax.text(1.05, 1.05, "Quick wins\n(ready + reusable)", ha="right", va="top",
            fontsize=8.5, color=CGIAR_GREEN, fontweight="bold")
    ax.text(0.13, 1.05, "Invest to mature", ha="left", va="top",
            fontsize=8.5, color="#888888")
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(color=GREY_LIGHT, linewidth=0.7, zorder=0)
    ax.set_axisbelow(True)
    leg = ax.legend(title="Access", loc="lower right", fontsize=8,
                    frameon=True, framealpha=0.9)
    leg.get_title().set_fontsize(8.5)
    fig.tight_layout()
    savefig(fig, "fig7_priority_quadrant.png")


# ---------------------------------------------------------------------------
# Figure 8 — Integration pathway (federate vs ingest vs negotiate)
# ---------------------------------------------------------------------------
def fig8_integration_pathway(assets):
    ORDER = ["Federate — ready", "Federate or light ingest", "Ingest candidate",
             "Negotiate access", "Assess"]
    COLOURS = {"Federate — ready": "#2E7D52", "Federate or light ingest": TEAL,
               "Ingest candidate": PROGRAM_BLUE_LT, "Negotiate access": "#E8843A",
               "Assess": GREY_MED}
    counts = Counter(a.get("integration_hint") for a in assets)
    labels = [l for l in ORDER if counts.get(l)]
    values = [counts[l] for l in labels]
    colours = [COLOURS[l] for l in labels]

    fig, ax = plt.subplots(figsize=(8, 3.0))
    bars = ax.barh(labels[::-1], values[::-1], color=colours[::-1],
                   height=0.62, edgecolor="none")
    total = sum(values)
    for bar in bars:
        w = bar.get_width()
        ax.text(w + 0.4, bar.get_y() + bar.get_height() / 2,
                f"{w:.0f}  ({w / total * 100:.0f}%)", va="center", fontsize=9)
    ax.set_xlabel("Number of assets", fontsize=10)
    ax.set_xlim(0, max(values) * 1.25)
    ax.tick_params(labelsize=9)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.grid(axis="x", color=GREY_LIGHT, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    fig.tight_layout()
    savefig(fig, "fig8_integration_pathway.png")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    with open(ASSETS_PATH) as f:
        assets = json.load(f)
    print(f"Loaded {len(assets)} assets")

    fig1_assets_per_centre(assets)
    fig2_climate_domains(assets)
    fig3_asset_types(assets)
    fig4_geographic_coverage(assets)
    fig5_heatmap(assets)
    fig6_gap_matrix(assets)
    fig7_priority_quadrant(assets)
    fig8_integration_pathway(assets)
    print("Done.")


if __name__ == "__main__":
    main()
