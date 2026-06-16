"""
report_common.py
----------------
Shared helpers for report generation across Markdown and Quarto outputs.
"""

import json
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent.parent
ASSETS_PATH = ROOT / "data" / "normalized" / "assets.json"
MERGE_LOG = ROOT / "data" / "merge_log.json"

HUB_FUNDED = {"Alliance", "IITA", "ILRI", "IFPRI", "IWMI", "WorldFish"}


def pct(n, total):
    return round(n / total * 100) if total else 0


def centre_label(c):
    return c.replace("_", "-")


def load():
    with open(ASSETS_PATH) as f:
        assets = json.load(f)
    with open(MERGE_LOG) as f:
        ml = json.load(f)
    return assets, ml


def compute_stats(assets, ml):
    total = len(assets)
    centre_counts = Counter(a["centre"] for a in assets)

    hub_total = sum(v for k, v in centre_counts.items() if k in HUB_FUNDED)
    non_hub_total = total - hub_total

    domain_counts = Counter(
        a["domain_norm"] for a in assets if a["domain_norm"] != "Not specified"
    )
    geo_counts = Counter(
        a["geo_norm"] for a in assets if a["geo_norm"] != "Not specified"
    )
    type_counts = Counter(a["type_norm"] for a in assets if a["type_norm"])

    n_ranked = sum(1 for a in assets if a.get("asset_rank"))
    n_hub_role = sum(1 for a in assets if a.get("hub_role"))

    centre_domain = {}
    for a in assets:
        c = a["centre"]
        d = a["domain_norm"]
        centre_domain.setdefault(c, Counter())[d] += 1

    applied_merges = ml.get("applied", [])
    raw_total = total + sum(m["entries_removed"] for m in applied_merges)

    # --- Decision-layer stats (Phase 2) -----------------------------------
    access_counts = Counter(a.get("access_norm", "Unknown") for a in assets)
    integration_counts = Counter(a.get("integration_hint") for a in assets
                                 if a.get("integration_hint"))
    role_counts = Counter(a.get("hub_role_norm", "Unspecified") for a in assets)

    scores = [a["priority_score"] for a in assets if a.get("priority_score") is not None]
    mean_score = round(sum(scores) / len(scores)) if scores else 0

    foundational_count = sum(1 for a in assets if a.get("foundational") is True)
    maintained_count = sum(1 for a in assets if a.get("actively_maintained") is True)

    # Domain × geography coverage matrix + gap cells.
    dg = {}
    for a in assets:
        dg.setdefault((a["domain_norm"], a["geo_norm"]), 0)
        dg[(a["domain_norm"], a["geo_norm"])] += 1

    # Concentration risk: domains carried by a single centre.
    domain_centres = {}
    for a in assets:
        domain_centres.setdefault(a["domain_norm"], set()).add(a["centre"])
    single_centre_domains = {
        d: next(iter(cs)) for d, cs in domain_centres.items()
        if len(cs) == 1 and d != "Not specified"
    }

    # Per-centre strength: asset count, mean priority, distinct domains.
    centre_strength = {}
    for c in centre_counts:
        c_assets = [a for a in assets if a["centre"] == c]
        c_scores = [a["priority_score"] for a in c_assets
                    if a.get("priority_score") is not None]
        centre_strength[c] = {
            "n": len(c_assets),
            "mean_score": round(sum(c_scores) / len(c_scores)) if c_scores else 0,
            "domains": sorted({a["domain_norm"] for a in c_assets
                               if a["domain_norm"] != "Not specified"}),
        }

    def rd(a):  # readiness 0..1
        return a.get("score_components", {}).get("technical_readiness")

    # "Ingest now": ready + open + valuable.
    ingest_now = sorted(
        [a for a in assets
         if a.get("access_norm") == "Open"
         and (rd(a) or 0) >= 0.75
         and (a.get("priority_score") or 0) >= 75],
        key=lambda a: -(a.get("priority_score") or 0),
    )
    # "Next cycle": high value but blocked by access or low readiness.
    ingest_now_names = {(a["centre"], a["name"]) for a in ingest_now}
    next_cycle = sorted(
        [a for a in assets
         if (a.get("priority_score") or 0) >= 70
         and (a["centre"], a["name"]) not in ingest_now_names
         and (a.get("access_norm") == "Restricted" or (rd(a) or 0) < 0.75)],
        key=lambda a: -(a.get("priority_score") or 0),
    )

    # Strategic nominations = the centres' OWN top-3 (strategy's ranking logic,
    # not our composite). Sort by centre then submitted rank.
    strategic = sorted(
        [a for a in assets if a.get("is_top3_in_centre")],
        key=lambda a: (a["centre"], a.get("asset_rank_num") or 99),
    )

    # Duplication / dependency: assets sharing the same climate inputs.
    input_counts = Counter()
    n_reported_inputs = 0
    for a in assets:
        ins = a.get("climate_inputs_norm") or []
        if ins:
            n_reported_inputs += 1
        for i in ins:
            input_counts[i] += 1
    shared_inputs = {i: n for i, n in input_counts.items() if n >= 2}

    national_counts = Counter(a.get("national_relevance") for a in assets
                              if a.get("national_relevance"))
    n_high_national = sum(1 for a in assets
                          if a.get("national_relevance") in ("High", "Very High"))
    n_cross_program = sum(1 for a in assets if a.get("cgiar_programs"))

    return {
        "total": total,
        "raw_total": raw_total,
        "hub_total": hub_total,
        "non_hub_total": non_hub_total,
        "centre_counts": centre_counts,
        "domain_counts": domain_counts,
        "geo_counts": geo_counts,
        "type_counts": type_counts,
        "n_ranked": n_ranked,
        "n_hub_role": n_hub_role,
        "centre_domain": centre_domain,
        "applied_merges": applied_merges,
        "recommended": ml.get("recommended_catalogue", []),
        "n_centres": len(centre_counts),
        "today": date.today().strftime("%B %Y"),
        # Decision layer
        "access_counts": access_counts,
        "integration_counts": integration_counts,
        "role_counts": role_counts,
        "mean_score": mean_score,
        "foundational_count": foundational_count,
        "maintained_count": maintained_count,
        "domain_geo": dg,
        "single_centre_domains": single_centre_domains,
        "centre_strength": centre_strength,
        "ingest_now": ingest_now,
        "next_cycle": next_cycle,
        "strategic": strategic,
        "shared_inputs": shared_inputs,
        "input_counts": input_counts,
        "n_reported_inputs": n_reported_inputs,
        "national_counts": national_counts,
        "n_high_national": n_high_national,
        "n_cross_program": n_cross_program,
    }


def build_report_body(assets, s, figures_prefix="figures"):
    lines = []
    W = lines.append

    def fig(name, alt):
        return f"{figures_prefix}/{name}" if figures_prefix else name

    W(f"## Executive Summary")
    W(f"")
    W(
        f"The CGIAR Climate Data Hub (CDH) conducted its first system-wide mapping of climate "
        f"data assets across CGIAR centres. **{s['total']} assets** were identified across "
        f"**{s['n_centres']} centres**, spanning climate hazard monitoring, adaptation analytics, "
        f"exposure mapping, mitigation accounting, and multi-domain integrated datasets."
    )
    W(f"")
    W(
        f"Of the {s['total']} catalogued assets, **{s['hub_total']} ({pct(s['hub_total'], s['total'])}%)** "
        f"originate from the six Hub-funded centres "
        f"({', '.join(centre_label(c) for c in sorted(HUB_FUNDED))})."
    )
    W(f"")

    top_domains = s["domain_counts"].most_common(3)
    W(
        f"The three most represented climate domains are "
        f"**{top_domains[0][0]}** ({top_domains[0][1]} assets), "
        f"**{top_domains[1][0]}** ({top_domains[1][1]}), and "
        f"**{top_domains[2][0]}** ({top_domains[2][1]}). "
        f"Geographically, Africa ({s['geo_counts'].get('Africa', 0)} assets) and Global "
        f"({s['geo_counts'].get('Global', 0)} assets) together account for "
        f"{pct(s['geo_counts'].get('Africa', 0) + s['geo_counts'].get('Global', 0), s['total'])}% "
        f"of the portfolio."
    )
    W(f"")
    W(
        f"**Headline for action:** following the mapping's design, each centre ranked its own "
        f"assets — the **{len(s['strategic'])} strategic nominations** (each centre's top three) "
        f"are flagged for immediate CDH consideration, with a centre-written justification "
        f"(Section 6.2). A complementary practical cut surfaces **{len(s['ingest_now'])} assets "
        f"ready to act on now** (open access, high technical readiness; Section 6.4). The clearest "
        f"portfolio gaps are **Adaptive Capacity** and the **Latin America & Caribbean** region "
        f"(Section 5). Assets also carry an optional composite score to aid sorting (Section 6.1) — "
        f"a navigation aid, not an official ranking."
    )
    W(f"")

    W(f"---")
    W(f"")
    W(f"## 1. Background and Objectives")
    W(f"")
    W(
        f"The CGIAR Climate Data Hub (CDH) is a CGIAR initiative under Area of Work 1 (AoW1), "
        f"designed to surface, standardise, and federate climate-relevant data assets held across "
        f"the CGIAR system. The Hub operates under a **federation model**: it points to data where "
        f"it already exists, rather than duplicating it, and only ingests data where cloud-optimised "
        f"or API-accessible formats are not available."
    )
    W(f"")
    W(
        f"This report summarises the first system-wide asset mapping exercise, conducted in early "
        f"2026. Centres were asked to nominate climate data assets through a structured submission "
        f"template covering identity, structure, spatiotemporal scope, thematic domain, context of "
        f"use, and a readiness/nomination assessment."
    )
    W(f"")
    W(
        f"Consistent with the mapping strategy, the exercise is deliberately **focused and "
        f"strategic, not exhaustive**: each centre nominated a limited set (up to ~20) of its "
        f"strongest, most decision-relevant assets, prioritising quality and reuse over volume. It "
        f"is **not an audit of past outputs, and not a scientific evaluation of data quality**, and "
        f"it does not alter data ownership or impose hosting requirements. It is a coordination and "
        f"governance step to inform Phase 1 of the Hub."
    )
    W(f"")
    W(f"**Objectives of the mapping:**")
    W(f"")
    W(f"1. Surface a focused, strategic set of high-value climate data assets across CGIAR (not an exhaustive inventory).")
    W(f"2. Identify gaps and priorities for Hub curation and integration.")
    W(f"3. Provide a foundation for cross-centre collaboration and data-sharing.")
    W(f"4. Inform the CDH technical roadmap for ingestion and federation.")
    W(f"")

    W(f"---")
    W(f"")
    W(f"## 2. Methods")
    W(f"")
    W(f"### 2.1 Submission process")
    W(f"")
    W(
        f"Each centre received a standardised Excel template with six thematic sheets. "
        f"Nominators were asked to complete one row per asset, covering:"
    )
    W(f"")
    W(f"- **Sheet A — Identity**: asset name, nominator, organisation, asset type, short description.")
    W(f"- **Sheet B — Structure**: file format, storage location, licence, API/access details.")
    W(f"- **Sheet C — SpatioTemp**: spatial coverage, resolution, temporal type, update frequency.")
    W(f"- **Sheet D — Thematic**: climate domain, farming system, commodity, output variable type.")
    W(f"- **Sheet E — Context & Use**: decision relevance, reuse potential, existing use cases.")
    W(
        f"- **Sheet F&G — Assess & Nominate**: technical readiness, contemporary validity, "
        f"sustainability, asset rank, and intended Hub role."
    )
    W(f"")
    W(f"Submissions were received from {s['n_centres']} centres.")
    W(f"")
    W(f"### 2.2 Normalisation")
    W(f"")
    W(
        f"Free-text fields for climate domain, asset type, and spatial coverage were normalised "
        f"to controlled vocabularies using keyword matching. The normalisation rules are documented "
        f"in `src/ingest.py` and applied reproducibly via the pipeline described in Section 2.4."
    )
    W(f"")
    W(f"### 2.3 Consolidation of duplicate entries")
    W(f"")
    W(
        f"{len(s['applied_merges'])} consolidations were applied where multiple submitted entries "
        f"represented sub-components of a single dataset (e.g. model inputs and outputs from the "
        f"same pipeline). This reduced the raw submission count of **{s['raw_total']}** to "
        f"**{s['total']}** catalogued assets. The full merge log is in Annex C."
    )
    W(f"")
    W(f"### 2.4 Reproducible pipeline")
    W(f"")
    W(
        f"All statistics in this report are computed programmatically from the raw Excel "
        f"submissions. Pipeline consists of three scripts:"
    )
    W(f"")
    W(f"| Script | Purpose |")
    W(f"|---|---|")
    W(f"| `src/ingest.py` | Read Excel files, normalise fields, apply merge log → `data/normalized/assets.json` |")
    W(f"| `src/figures.py` | Generate all figures from `assets.json` |")
    W(f"| `src/report.py` | Generate Markdown version of report |")
    W(f"| `report.qmd` | Generate Quarto source for HTML/PDF/Word rendering |")
    W(f"")
    W(f"To regenerate report after receiving new submissions:")
    W(f"")
    W(f"```bash")
    W(f"python src/ingest.py && python src/figures.py && python src/report.py")
    W(f"quarto render report.qmd --to html")
    W(f"```")
    W(f"")

    W(f"---")
    W(f"")
    W(f"## 3. Domain Definitions")
    W(f"")
    W(f"The following climate domain vocabulary is used throughout this report:")
    W(f"")
    W(f"| Domain | Definition |")
    W(f"|---|---|")
    W(
        f"| **Hazard** | Climate variables and indices that characterise physical hazard "
        f"(e.g. rainfall, temperature, drought, flood extent). |"
    )
    W(
        f"| **Hazard / Climate Services** | Operationally processed hazard products delivered "
        f"as services (e.g. seasonal forecasts, advisories). |"
    )
    W(
        f"| **Exposure** | Data on agricultural systems, land use, populations, and assets "
        f"exposed to climate hazards. |"
    )
    W(
        f"| **Sensitivity** | Data on how exposed systems respond to climate stressors "
        f"(e.g. crop yield sensitivity, disease risk models). |"
    )
    W(
        f"| **Adaptive Capacity** | Data on capacity of systems or communities to adjust "
        f"to climate impacts. |"
    )
    W(
        f"| **Adaptation Analytics** | Integrated datasets and model outputs that assess "
        f"adaptation options, impacts, or trade-offs (combines hazard, exposure, and response). |"
    )
    W(
        f"| **Mitigation** | GHG inventories, emission factors, and tools for quantifying "
        f"emission reductions in agriculture. |"
    )
    W(
        f"| **Multi-domain** | Assets that span two or more domains without clear primary "
        f"classification. |"
    )
    W(
        f"| **Hybrid labels** | Some assets are tagged with two adjacent domains "
        f"(e.g. Sensitivity / Adaptation Analytics) where single label would be misleading. |"
    )
    W(f"")
    W(
        f"*These labels follow the mapping strategy's domain vocabulary. The strategy lists "
        f"**Climate finance** and **Climate policy** as separate domains; given the small number "
        f"of assets in either, this report combines them under **Climate Policy / Finance** — they "
        f"can be split if future submissions warrant.*"
    )
    W(f"")

    W(f"---")
    W(f"")
    W(f"## 4. Results")
    W(f"")
    W(f"### 4.1 Volume and coverage")
    W(f"")
    W(
        f"A total of **{s['total']} assets** were catalogued across {s['n_centres']} centres "
        f"(Figure 1). All figures reported here reflect post-consolidation count "
        f"(see Section 2.3 and Annex C)."
    )
    W(f"")
    W(f"![Figure 1 — Assets per centre]({fig('fig1_assets_per_centre.png', 'Figure 1')})")
    W(f"")
    W(f"| Centre | Assets | Hub-funded |")
    W(f"|---|---|---|")
    for c, n in sorted(s["centre_counts"].items(), key=lambda x: -x[1]):
        tag = "Yes" if c in HUB_FUNDED else "No"
        W(f"| {centre_label(c)} | {n} | {tag} |")
    W(f"| **Total** | **{s['total']}** | |")
    W(f"")
    W(
        f"Hub-funded centres account for **{s['hub_total']} assets ({pct(s['hub_total'], s['total'])}%)** "
        f"of portfolio."
    )
    W(f"")

    W(f"### 4.2 Domain distribution")
    W(f"")
    W(f"![Figure 2 — Domain distribution]({fig('fig2_climate_domains.png', 'Figure 2')})")
    W(f"")

    top2 = s["domain_counts"].most_common(2)
    W(
        f"**{top2[0][0]}** is most represented domain ({top2[0][1]} assets, "
        f"{pct(top2[0][1], s['total'])}%), followed by **{top2[1][0]}** ({top2[1][1]} assets). "
        f"**Multi-domain** assets ({s['domain_counts'].get('Multi-domain', 0)} assets) "
        f"reflect submissions where nominated asset spans two or more domains — common for "
        f"integrated platforms and modelling frameworks."
    )
    W(f"")
    W(
        f"High Multi-domain share from IITA reflects their submission labels "
        f"('Agronomy and climate', 'Disease risk') which span exposure, sensitivity, and adaptation. "
        f"CIFOR-ICRAF's multi-domain assets include food security and livelihoods datasets with "
        f"indirect but significant climate relevance. See Figure 5 for centre-by-domain breakdown."
    )
    W(f"")

    W(f"#### Cross-centre domain coverage")
    W(f"")
    W(f"![Figure 5 — Centre × domain heatmap]({fig('fig5_heatmap_centre_domain.png', 'Figure 5')})")
    W(f"")
    W(
        f"Heatmap shows number of assets per centre per domain. Hybrid domain labels "
        f"(e.g. Sensitivity / Adaptation Analytics, Adaptation Analytics / Mitigation) are "
        f"excluded from heatmap for readability; they are included in Figure 2."
    )
    W(f"")

    W(f"### 4.3 Ownership and asset type")
    W(f"")
    W(f"![Figure 3 — Asset types]({fig('fig3_asset_types.png', 'Figure 3')})")
    W(f"")
    cgiar_n = s["type_counts"].get("CGIAR-produced", 0)
    ext_n = s["type_counts"].get("External", 0)
    cop_n = s["type_counts"].get("Co-produced", 0)
    W(
        f"**{cgiar_n} assets ({pct(cgiar_n, s['total'])}%)** are CGIAR-produced; "
        f"**{ext_n} ({pct(ext_n, s['total'])}%)** are external datasets adopted into CGIAR "
        f"workflows; and **{cop_n} ({pct(cop_n, s['total'])}%)** are co-produced with external "
        f"partners. External assets are included where centres have demonstrated active use in "
        f"climate analytics and where Hub can add value through standardisation or linkage."
    )
    W(f"")

    W(f"### 4.4 Geographic coverage")
    W(f"")
    W(f"![Figure 4 — Geographic coverage]({fig('fig4_geographic_coverage.png', 'Figure 4')})")
    W(f"")
    africa_n = s["geo_counts"].get("Africa", 0)
    global_n = s["geo_counts"].get("Global", 0)
    asia_n = s["geo_counts"].get("Asia / South & SE Asia", 0)
    lac_n = s["geo_counts"].get("Latin America & Caribbean", 0)
    W(
        f"Africa ({africa_n} assets) and Global ({global_n} assets) together represent "
        f"{pct(africa_n + global_n, s['total'])}% of portfolio. Asia and South/Southeast Asia "
        f"({asia_n} assets) is driven primarily by IRRI. Latin America & Caribbean ({lac_n} assets) "
        f"is represented by Alliance and CIP submissions."
    )
    n_unspec_geo = sum(1 for a in assets if a["geo_norm"] == "Not specified")
    if n_unspec_geo:
        W(f"")
        W(
            f"*{n_unspec_geo} assets had no spatial coverage specified in submission and are "
            f"excluded from Figure 4.*"
        )
    W(f"")

    W(f"### 4.5 Priority nominations")
    W(f"")
    W(
        f"Of {s['total']} catalogued assets, **{s['n_ranked']} ({pct(s['n_ranked'], s['total'])}%)** "
        f"include Asset Rank (Section F&G of submission template) and "
        f"**{s['n_hub_role']} ({pct(s['n_hub_role'], s['total'])}%)** specify intended Hub Role."
    )
    W(f"")
    W(f"Intended Hub Roles describe how asset should be integrated with Hub:")
    W(f"")
    W(f"- **Hub Native** — asset will be ingested and hosted directly by Hub.")
    W(f"- **Hub Reference** — Hub will link to asset at its existing location, without ingesting copy.")
    W(f"- **Hub Derived** — Hub will produce derived or value-added product from asset.")
    W(f"")
    W(
        f"Hub preference is federation over ingestion. Datasets in existing platforms that are "
        f"not cloud-optimised or available by API may require ingestion to enable interoperability; "
        f"in such cases Hub will work with data owner to agree on approach. "
        f"Where permissions already allow it, Hub may proceed without delay; otherwise, "
        f"formal agreement with data owner is required before ingestion."
    )
    W(f"")

    W(f"---")
    W(f"")
    W(f"## 5. Strength and Gap Analysis")
    W(f"")
    W(
        f"This section is written for the **CDH Core team**: where the system-wide "
        f"portfolio is strong, where it is thin, and where coverage depends on a single "
        f"centre."
    )
    W(f"")
    W(f"### 5.1 Domain × geography coverage")
    W(f"")
    W(f"![Figure 6 — Domain × geography coverage matrix]({fig('fig6_gap_matrix.png', 'Figure 6')})")
    W(f"")
    dg = s["domain_geo"]
    CANON = [
        "Hazard", "Hazard / Climate Services", "Exposure", "Sensitivity",
        "Adaptive Capacity", "Adaptation Analytics", "Mitigation",
        "Climate Policy / Finance", "Multi-domain",
    ]
    CANON_GEO = ["Africa", "Asia / South & SE Asia",
                 "Latin America & Caribbean", "Global", "Multi-regional"]
    empty_cells = sum(1 for d in CANON for g in CANON_GEO if dg.get((d, g), 0) == 0)
    empty_domains = [d for d in CANON
                     if sum(dg.get((d, g), 0) for g in CANON_GEO) == 0]
    W(
        f"Coverage concentrates in two cells — **Hazard × Africa** "
        f"({dg.get(('Hazard', 'Africa'), 0)} assets) and **Adaptation Analytics × Africa** "
        f"({dg.get(('Adaptation Analytics', 'Africa'), 0)} assets) — alongside a strong "
        f"**Global** column. Of the {len(CANON) * len(CANON_GEO)} domain × geography "
        f"combinations, **{empty_cells} are empty**."
    )
    W(f"")
    if empty_domains:
        W(
            f"The clearest thematic gap is **{', '.join(empty_domains)}**, with no catalogued "
            f"assets in any region. **Latin America & Caribbean** and **Multi-regional** are "
            f"the thinnest geographies across nearly every domain."
        )
        W(f"")

    W(f"### 5.2 Concentration risk")
    W(f"")
    scd = s["single_centre_domains"]
    if scd:
        W(
            f"**{len(scd)} domain(s)** are currently represented by a single centre, making "
            f"system-wide coverage dependent on one submitter:"
        )
        W(f"")
        W(f"| Domain | Sole centre |")
        W(f"|---|---|")
        for d, c in sorted(scd.items()):
            W(f"| {d} | {centre_label(c)} |")
        W(f"")
        W(
            f"These are priorities for cross-centre outreach: a second submitter would reduce "
            f"single-point dependency and validate the domain's representation."
        )
    else:
        W(f"No single-centre domain dependencies detected.")
    W(f"")

    W(f"### 5.3 Per-centre strength profile")
    W(f"")
    W(
        f"Mean priority score summarises each centre's portfolio on the shared 0–100 scale "
        f"(see Section 6.1). 'Domains' counts the distinct climate domains a centre covers."
    )
    W(f"")
    W(f"| Centre | Assets | Mean priority | Domains covered | Hub-funded |")
    W(f"|---|---|---|---|---|")
    for c, st in sorted(s["centre_strength"].items(),
                        key=lambda x: -x[1]["mean_score"]):
        tag = "Yes" if c in HUB_FUNDED else "No"
        W(f"| {centre_label(c)} | {st['n']} | {st['mean_score']} | {len(st['domains'])} | {tag} |")
    W(f"")

    W(f"---")
    W(f"")
    W(f"## 6. Priorities and Actions")
    W(f"")
    W(
        f"This section is written for the **CDH development and data team**: which assets to "
        f"act on now, which to queue for the next cycle, and the suggested integration "
        f"pathway for each."
    )
    W(f"")
    W(f"### 6.1 How to read priority here")
    W(f"")
    W(
        f"The mapping strategy is deliberate that the five qualitative criteria are a "
        f"**comparison aid, not a formal score or ranked list** — collapsing them into a single "
        f"number would oversimplify. This report follows that intent: the authoritative signal is "
        f"each **centre's own ranking**, and the **top three assets per centre are the strategic "
        f"nominations** for immediate Hub consideration (Section 6.2)."
    )
    W(f"")
    W(
        f"As a navigation convenience only, each asset additionally carries an **optional "
        f"composite score (0–100)** — a weighted blend of the five criteria, submitted rank, and "
        f"hub-role specification, computed reproducibly in `src/ingest.py` and shared with the "
        f"dashboard so the two never diverge. Treat it strictly as a sorting aid for long lists, "
        f"**not as an official quality verdict**; absent criteria are dropped from the blend rather "
        f"than penalised. Portfolio mean **{s['mean_score']}**."
    )
    W(f"")

    W(f"### 6.2 Strategic nominations — each centre's top three")
    W(f"")
    W(
        f"**{len(s['strategic'])} assets** were ranked in their centre's top three. Under the "
        f"mapping strategy these are the unit for **immediate Hub inclusion or federation**; "
        f"lower-ranked assets are candidates for later cycles. Each top-ranked asset carries a "
        f"centre-written justification (summarised below; full text in the asset record)."
    )
    W(f"")
    W(f"| Centre | Rank | Asset | Domain | Access | Pathway | Centre justification |")
    W(f"|---|---|---|---|---|---|---|")
    for a in s["strategic"]:
        name = a["name"].replace("|", "\\|")[:42]
        why = (a.get("justification") or a.get("primary_use_case") or "").replace("|", "\\|").replace("\n", " ")[:90]
        W(
            f"| {centre_label(a['centre'])} | {a.get('asset_rank') or '—'} | {name} | "
            f"{a['domain_norm']} | {a.get('access_norm', '—')} | {a.get('integration_hint', '—')} | {why} |"
        )
    W(f"")

    W(f"### 6.3 Priority quadrant")
    W(f"")
    W(f"![Figure 7 — Priority quadrant]({fig('fig7_priority_quadrant.png', 'Figure 7')})")
    W(f"")
    W(
        f"Assets in the top-right quadrant (high technical readiness **and** high reuse "
        f"potential) are the natural quick wins. Bubble size reflects decision relevance and "
        f"colour reflects access status — **green (Open)** assets in the top-right are the "
        f"fastest to act on; **orange (Restricted)** assets of equal value require an access "
        f"conversation first."
    )
    W(f"")

    W(f"### 6.4 Suggested integration pathway")
    W(f"")
    W(f"![Figure 8 — Suggested integration pathway]({fig('fig8_integration_pathway.png', 'Figure 8')})")
    W(f"")
    ic = s["integration_counts"]
    W(
        f"A heuristic combining access status and file format suggests a starting integration "
        f"pathway per asset. **{ic.get('Federate — ready', 0) + ic.get('Federate or light ingest', 0)} "
        f"assets** look federation-ready or close to it; **{ic.get('Negotiate access', 0)}** are "
        f"gated behind an access conversation; **{ic.get('Ingest candidate', 0)}** are open but "
        f"need ingestion to become interoperable. These labels are advisory — verify format and "
        f"licence per asset before committing."
    )
    W(f"")
    W(
        f"Of the {s['total']} assets, **{s['access_counts'].get('Open', 0)}** are Open access, "
        f"**{s['access_counts'].get('Restricted', 0)}** Restricted, and "
        f"**{s['access_counts'].get('Unknown', 0)}** unspecified. "
        f"**{s['foundational_count']}** are flagged foundational to ongoing CGIAR work and "
        f"**{s['maintained_count']}** are reported as actively maintained."
    )
    W(f"")

    def action_row(a):
        name = a["name"].replace("|", "\\|")[:48]
        why = (a.get("justification") or a.get("primary_use_case")
               or a.get("short_description") or "")
        why = why.replace("|", "\\|").replace("\n", " ")[:80]
        return name, why

    W(f"### 6.5 Act now — ready, open, high value")
    W(f"")
    inow = s["ingest_now"]
    W(
        f"**{len(inow)} assets** combine Open access, high technical readiness, and a priority "
        f"score of 75+. These are the recommended near-term targets for federation or "
        f"ingestion (top {min(len(inow), 15)} shown):"
    )
    W(f"")
    W(f"| Score | Centre | Asset | Domain | Pathway | Rationale |")
    W(f"|---|---|---|---|---|---|")
    for a in inow[:15]:
        name, why = action_row(a)
        W(
            f"| {a['priority_score']} | {centre_label(a['centre'])} | {name} | "
            f"{a['domain_norm']} | {a.get('integration_hint', '')} | {why} |"
        )
    W(f"")

    W(f"### 6.6 Next cycle — high value, currently blocked")
    W(f"")
    nxt = s["next_cycle"]
    W(
        f"**{len(nxt)} assets** score 70+ but are held back by restricted access or "
        f"sub-'High' technical readiness. These warrant an access conversation or a readiness "
        f"investment before the next mapping cycle (top {min(len(nxt), 12)} shown):"
    )
    W(f"")
    W(f"| Score | Centre | Asset | Domain | Blocker | Pathway |")
    W(f"|---|---|---|---|---|---|")
    for a in nxt[:12]:
        name, _ = action_row(a)
        rd_sc = a.get("score_components", {}).get("technical_readiness")
        blocker = ("Restricted access" if a.get("access_norm") == "Restricted"
                   else "Readiness below High")
        W(
            f"| {a['priority_score']} | {centre_label(a['centre'])} | {name} | "
            f"{a['domain_norm']} | {blocker} | {a.get('integration_hint', '')} |"
        )
    W(f"")

    W(f"### 6.7 Shared dependencies and reuse signals")
    W(f"")
    si = s["shared_inputs"]
    if si:
        top = sorted(si.items(), key=lambda x: -x[1])
        lead = ", ".join(f"**{k}** ({v})" for k, v in top[:4])
        W(
            f"**Duplication of climate inputs.** Of the **{s['n_reported_inputs']} assets** that "
            f"reported their underlying climate inputs, several inputs recur across multiple "
            f"submissions — {lead}. Shared upstream inputs are prime candidates for **once-only Hub "
            f"preprocessing** (a stated aim of the mapping: detecting duplication in climate inputs "
            f"and pipelines) rather than each centre reprocessing the same source independently."
        )
        W(f"")
        W(f"| Climate input | Assets relying on it |")
        W(f"|---|---|")
        for k, v in top:
            W(f"| {k} | {v} |")
        W(f"")
        W(
            f"*Only {s['n_reported_inputs']} of {s['total']} assets recorded their climate inputs; "
            f"enforcing this field next cycle would complete the dependency picture.*"
        )
        W(f"")
    W(
        f"**Cross-programme reuse.** **{s['n_cross_program']} assets** name the CGIAR programmes "
        f"already using them — direct evidence of reuse beyond the originating team, which the "
        f"strategy treats as a core signal for Hub inclusion."
    )
    W(f"")
    W(
        f"**National relevance.** **{s['n_high_national']} assets** are rated High or Very High for "
        f"national relevance — the datasets most important for country engagement, policy dialogue, "
        f"and partner buy-in. The strategy flags these as priorities even where they are not "
        f"globally standardised or openly accessible."
    )
    W(f"")

    W(f"---")
    W(f"")
    W(f"## 7. Discussion")
    W(f"")
    W(f"### 7.1 Coverage and gaps")
    W(f"")
    W(
        f"Mapping captures substantial portion of CGIAR's climate data portfolio, but is not "
        f"exhaustive. ICARDA has not yet submitted; their inclusion will affect totals."
    )
    W(f"")
    W(
        f"Thematic gaps visible in current inventory include: limited **Adaptive Capacity** "
        f"assets ({s['domain_counts'].get('Adaptive Capacity', 0)} assets), relatively few "
        f"**Mitigation** datasets outside GHG accounting tools, and sparse coverage of "
        f"**Latin America & Caribbean** beyond Alliance and CIP."
    )
    W(f"")
    W(f"### 7.2 Data quality observations")
    W(f"")
    W(
        f"Several fields were incomplete across submissions: asset rank and Hub role were blank "
        f"for substantial share of assets. Centres have been contacted to complete missing "
        f"assessments in next submission cycle."
    )
    W(f"")
    n_unspec_dom = sum(1 for a in assets if a["domain_norm"] == "Not specified")
    if n_unspec_dom:
        W(
            f"**{n_unspec_dom} asset(s)** had no climate domain specified and could not be "
            f"classified from context. These are retained in inventory but excluded from "
            f"domain figures."
        )
        W(f"")

    W(f"### 7.3 Hub integration approach")
    W(f"")
    W(
        f"CDH operates **federation-first** model. Many CGIAR data products already reside "
        f"in well-maintained platforms (CGIAR Library, data.cgiar.org, institutional repositories). "
        f"Hub preference is to register and link these rather than duplicate them."
    )
    W(f"")
    W(
        f"Where data is not cloud-optimised, not accessible by API, or not in standardised "
        f"format compatible with other CDH datasets, Hub may work with data owner to "
        f"improve format or — where necessary — ingest copy. In all cases, CDH will "
        f"notify data owner and, where permissions do not already allow federation, agree "
        f"approach before proceeding."
    )
    W(f"")
    W(
        f"Many CDH data products will be open access. CDH intends to link back into existing "
        f"portals and platforms so that Hub amplifies rather than duplicates those investments."
    )
    W(f"")

    W(f"---")
    W(f"")
    W(f"## 8. Next Steps")
    W(f"")
    W(f"1. **Complete outstanding submissions** — follow up with ICARDA and centres with incomplete assessment fields.")
    W(f"2. **Prioritise assets for Hub integration** — use asset rank and Hub role to sequence technical work.")
    W(f"3. **Agree federation vs ingestion for each priority asset** — work with data owners to determine appropriate integration pathway.")
    W(f"4. **Publish asset catalogue** — make inventory available to CGIAR partners via CDH portal.")
    W(f"5. **Iterate mapping annually** — re-run pipeline as new submissions arrive.")
    W(f"")

    W(f"---")
    W(f"")
    W(f"## Annex A — Full asset list")
    W(f"")
    W(f"| # | Centre | Asset Name | Domain | Geo | Type | Score | Access | Pathway |")
    W(f"|---|---|---|---|---|---|---|---|---|")
    for i, a in enumerate(
        sorted(assets, key=lambda x: -(x.get("priority_score") or 0)), 1
    ):
        name = a["name"].replace("|", "\\|")[:55]
        domain = a["domain_norm"] or ""
        geo = a["geo_norm"] or ""
        atype = (a["type_norm"] or "").replace("CGIAR-produced", "CGIAR")
        score = a.get("priority_score") if a.get("priority_score") is not None else "—"
        access = a.get("access_norm", "—")
        path = a.get("integration_hint", "—")
        W(
            f"| {i} | {centre_label(a['centre'])} | {name} | {domain} | {geo} | "
            f"{atype} | {score} | {access} | {path} |"
        )
    W(f"")

    W(f"---")
    W(f"")
    W(f"## Annex B — Submission completeness")
    W(f"")
    W(f"| Centre | Assets | Has Rank | Has Hub Role |")
    W(f"|---|---|---|---|")
    for c in sorted(s["centre_counts"]):
        c_assets = [a for a in assets if a["centre"] == c]
        n = len(c_assets)
        n_rank = sum(1 for a in c_assets if a.get("asset_rank"))
        n_role = sum(1 for a in c_assets if a.get("hub_role"))
        W(f"| {centre_label(c)} | {n} | {n_rank}/{n} | {n_role}/{n} |")
    W(f"")

    W(f"---")
    W(f"")
    W(f"## Annex C — Merge log")
    W(f"")
    W(f"### C.1 Applied consolidations")
    W(f"")
    W(f"| Centre | Original entries | Consolidated name | Entries removed | Rationale |")
    W(f"|---|---|---|---|---|")
    for m in s["applied_merges"]:
        originals = "; ".join(m["merged_names"])
        W(
            f"| {centre_label(m['centre'])} | {originals} | {m['consolidated_name']} "
            f"| {m['entries_removed']} | {m['rationale']} |"
        )
    W(f"")
    W(f"### C.2 Recommended for catalogue")
    W(f"")
    W(
        f"The following additional consolidations are recommended when building public "
        f"catalogue, but were not applied to analysis inventory:"
    )
    W(f"")
    for r in s["recommended"]:
        W(f"- **{centre_label(r['centre'])}**: {r['note']}")
    W(f"")

    return "\n".join(lines)


def build_markdown_report(assets, s, figures_prefix="figures"):
    lines = [
        "# CGIAR Climate Data Hub — System-Wide Climate Data Asset Mapping",
        "",
        "**Version:** 1.0-draft  ",
        f"**Date:** {s['today']}  ",
        "**Status:** Internal review draft",
        "",
        "---",
        "",
        build_report_body(assets, s, figures_prefix=figures_prefix),
    ]
    return "\n".join(lines)
