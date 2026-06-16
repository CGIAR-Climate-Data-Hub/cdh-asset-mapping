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


# ---------------------------------------------------------------------------
# Figure 1 — Assets per centre
# ---------------------------------------------------------------------------
def fig1_assets_per_centre(assets):
    counts = Counter(a["centre"] for a in assets)
    centres = sorted(counts, key=counts.get, reverse=True)
    values  = [counts[c] for c in centres]
    colours = bar_colours(centres, HUB_FUNDED)

    fig, ax = plt.subplots(figsize=(8, 4.5))
    bars = ax.barh(centres[::-1], values[::-1], color=colours[::-1],
                   height=0.65, edgecolor="none")
    ax.bar_label(bars, padding=4, fontsize=9, color="#333333")
    ax.set_xlabel("Number of assets", fontsize=10)
    ax.set_xlim(0, max(values) * 1.18)
    ax.tick_params(axis="y", labelsize=9)
    ax.tick_params(axis="x", labelsize=9)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.grid(axis="x", color=GREY_LIGHT, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)

    # Legend
    patch_hub  = mpatches.Patch(color=PROGRAM_BLUE,    label="Hub-funded centre")
    patch_non  = mpatches.Patch(color=PROGRAM_BLUE_LT, label="Non-hub-funded centre")
    ax.legend(handles=[patch_hub, patch_non], loc="lower right",
              fontsize=8, frameon=False)
    fig.tight_layout(rect=[0, 0, 1, 0.95])
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

    fig, ax = plt.subplots(figsize=(9, 5))
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

    n_unspec = sum(1 for a in assets if a["domain_norm"] == "Not specified")
    if n_unspec:
        ax.annotate(f"Note: {n_unspec} asset(s) with unspecified domain excluded",
                    xy=(0.98, 0.02), xycoords="axes fraction", ha="right",
                    fontsize=7.5, color="#888888", style="italic")
    ax.annotate("Domain definitions: Section 3.1",
                xy=(0.98, 0.06), xycoords="axes fraction", ha="right",
                fontsize=7.5, color="#888888", style="italic")
    fig.tight_layout(rect=[0, 0, 1, 0.95])
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

    fig, ax = plt.subplots(figsize=(6, 3.5))
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

    fig, ax = plt.subplots(figsize=(7, 3.8))
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

    n_unspec = sum(1 for a in assets if a["geo_norm"] == "Not specified")
    if n_unspec:
        ax.annotate(f"Note: {n_unspec} asset(s) with unspecified coverage excluded",
                    xy=(0.98, 0.02), xycoords="axes fraction", ha="right",
                    fontsize=7.5, color="#888888", style="italic")
    fig.tight_layout(rect=[0, 0, 1, 0.95])
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

    cell_size = 0.72   # inches per cell — square
    fig_w = cell_size * len(HEATMAP_DOMAINS) + 2.0
    fig_h = cell_size * len(centres_ordered) + 1.2

    fig, ax = plt.subplots(figsize=(fig_w, fig_h))

    # Custom blue colormap: white → program blue
    from matplotlib.colors import LinearSegmentedColormap
    cmap = LinearSegmentedColormap.from_list(
        "cdh_blue", ["#FFFFFF", PROGRAM_BLUE_LT, PROGRAM_BLUE])

    im = ax.imshow(matrix, aspect="equal", cmap=cmap,
                   vmin=0, vmax=max(matrix.max(), 1))

    # Annotate cells
    for ri in range(len(centres_ordered)):
        for ci in range(len(HEATMAP_DOMAINS)):
            v = matrix[ri, ci]
            if v > 0:
                txt_col = "white" if v >= matrix.max() * 0.6 else CGIAR_GREEN
                ax.text(ci, ri, str(v), ha="center", va="center",
                        fontsize=9, color=txt_col, fontweight="bold")

    # Axes
    ax.set_xticks(range(len(HEATMAP_DOMAINS)))
    ax.set_xticklabels(HEATMAP_DOMAINS, rotation=40, ha="right", fontsize=8)
    ax.xaxis.set_ticks_position("top")
    ax.xaxis.set_label_position("top")
    ax.set_yticks(range(len(centres_ordered)))
    ax.set_yticklabels(centres_ordered, fontsize=9)

    # Thin grid lines between cells
    ax.set_xticks(np.arange(-0.5, len(HEATMAP_DOMAINS)), minor=True)
    ax.set_yticks(np.arange(-0.5, len(centres_ordered)), minor=True)
    ax.grid(which="minor", color="white", linewidth=1.5)
    ax.tick_params(which="minor", length=0)
    ax.tick_params(which="major", length=0)
    for spine in ax.spines.values():
        spine.set_visible(False)

    # Footnote for hybrid/multi-label assets excluded from heatmap
    n_excluded = sum(1 for a in assets if a["domain_norm"] not in HEATMAP_DOMAINS
                     and a["domain_norm"] != "Not specified")
    if n_excluded:
        fig.text(0.5, 0.01,
                 f"Note: {n_excluded} asset(s) with hybrid domain labels "
                 f"(e.g. Sensitivity / Adaptation Analytics) excluded from heatmap.",
                 ha="center", fontsize=7.5, color="#888888", style="italic")
    fig.tight_layout(rect=[0, 0.04, 1, 0.96])
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

    cell = 0.82
    fig, ax = plt.subplots(figsize=(cell * len(GEOS) + 3.2,
                                    cell * len(DOMAINS) + 1.4))
    from matplotlib.colors import LinearSegmentedColormap
    cmap = LinearSegmentedColormap.from_list(
        "cdh_blue", ["#FFFFFF", PROGRAM_BLUE_LT, PROGRAM_BLUE])
    im = ax.imshow(matrix, aspect="equal", cmap=cmap,
                   vmin=0, vmax=max(matrix.max(), 1))

    for ri in range(len(DOMAINS)):
        for ci in range(len(GEOS)):
            v = matrix[ri, ci]
            if v == 0:
                # Flag genuine gaps with a hollow marker.
                ax.text(ci, ri, "·", ha="center", va="center",
                        fontsize=14, color="#C9492F")
            else:
                col = "white" if v >= matrix.max() * 0.6 else CGIAR_GREEN
                ax.text(ci, ri, str(v), ha="center", va="center",
                        fontsize=9, color=col, fontweight="bold")

    ax.set_xticks(range(len(GEOS)))
    ax.set_xticklabels(GEOS, rotation=35, ha="left", fontsize=8)
    ax.xaxis.set_ticks_position("top")
    ax.xaxis.set_label_position("top")
    ax.set_yticks(range(len(DOMAINS)))
    ax.set_yticklabels(DOMAINS, fontsize=8.5)
    ax.set_xticks(np.arange(-0.5, len(GEOS)), minor=True)
    ax.set_yticks(np.arange(-0.5, len(DOMAINS)), minor=True)
    ax.grid(which="minor", color="white", linewidth=1.5)
    ax.tick_params(which="both", length=0)
    for spine in ax.spines.values():
        spine.set_visible(False)
    n_excl = sum(1 for a in assets if a["domain_norm"] not in DOMAINS
                 or a["geo_norm"] not in GEOS)
    fig.text(0.5, 0.01, f"Red dot = no asset (coverage gap). "
             f"{n_excl} asset(s) with hybrid domain / unspecified geography excluded.",
             ha="center", fontsize=7.5, color="#888888", style="italic")
    fig.tight_layout(rect=[0, 0.04, 1, 0.94])
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
        dr = sc.get("decision_relevance") or 0.5
        acc = a.get("access_norm", "Unknown")
        # Jitter discrete ordinal values so points separate.
        jx = x + rng.normal(0, 0.02)
        jy = y + rng.normal(0, 0.02)
        ax.scatter(jx, jy, s=40 + dr * 320, alpha=0.6,
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
    ax.annotate("Bubble size = decision relevance", xy=(0.13, 0.13),
                fontsize=7.5, color="#888888", style="italic")
    fig.tight_layout(rect=[0, 0, 1, 0.95])
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

    fig, ax = plt.subplots(figsize=(8, 3.6))
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
    ax.annotate("Heuristic from access status + file format — advisory, verify per asset.",
                xy=(0.98, -0.22), xycoords="axes fraction", ha="right",
                fontsize=7.5, color="#888888", style="italic")
    fig.tight_layout(rect=[0, 0, 1, 0.95])
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
