"""
report_common.py
----------------
Shared helpers for report generation across Markdown and Quarto outputs.
"""

import json
import urllib.parse
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

    # Rank data-quality: centres with duplicate/tied ranks or none at all.
    dup_rank_centres, unranked_centres = [], []
    for c in centre_counts:
        rs = [a["asset_rank_num"] for a in assets
              if a["centre"] == c and a.get("asset_rank_num")]
        if not rs:
            unranked_centres.append(c)
        elif len(rs) != len(set(rs)):
            dup_rank_centres.append(c)

    national_counts = Counter(a.get("national_relevance") for a in assets
                              if a.get("national_relevance"))
    n_high_national = sum(1 for a in assets
                          if a.get("national_relevance") in ("High", "Very High"))
    n_cross_program = sum(1 for a in assets if a.get("cgiar_programs"))

    # Sheet D / E narrative signals (keyword presence over free-text fields).
    def kw_share(field, terms):
        out = {}
        for label, kw in terms.items():
            out[label] = sum(1 for a in assets
                             if a.get(field) and kw in str(a[field]).lower())
        return out

    use_kw = kw_share("primary_use_case", {
        "Policy": "polic", "Advisory": "advisor", "Modelling": "model",
        "Investment": "invest", "Research": "research", "Monitoring": "monitor"})
    user_kw = kw_share("user_groups", {
        "Researchers": "research", "Governments": "govern", "Donors": "donor",
        "Private sector": "privat", "Communities/farmers": "farmer"})
    commodity_kw = kw_share("commodity", {
        "Rice": "rice", "Maize": "maize", "Wheat": "wheat", "Potato/sweetpotato": "potato",
        "Fish/aquatic": "fish", "Livestock": "livestock", "Cassava": "cassava"})
    farming_kw = kw_share("farming_system", {
        "Cropping": "crop", "Livestock": "livestock", "Mixed": "mixed",
        "Aquatic": "aqua", "Agroforestry": "agrofor", "Rice-based": "rice"})
    n_output = sum(1 for a in assets if a.get("output_variable_type"))

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
        "dup_rank_centres": dup_rank_centres,
        "unranked_centres": unranked_centres,
        "use_kw": use_kw,
        "user_kw": user_kw,
        "commodity_kw": commodity_kw,
        "farming_kw": farming_kw,
        "n_output": n_output,
    }


def build_report_body(assets, s, figures_prefix="figures"):
    lines = []
    W = lines.append

    def fig(name, alt):
        return f"{figures_prefix}/{name}" if figures_prefix else name

    def linked(a, n=60):
        """Asset name as a markdown link to its data URL when available."""
        nm = (a["name"] or "")[:n].replace("|", "\\|")
        url = a.get("url")
        return f"[{nm}]({url})" if url else nm

    def short_why(a, n=160):
        why = (a.get("justification") or a.get("primary_use_case")
               or a.get("short_description") or "")
        return why.replace("|", "\\|").replace("\n", " ")[:n]

    def topkw(d, n=3):
        items = [(k, v) for k, v in sorted(d.items(), key=lambda x: -x[1]) if v]
        return ", ".join(f"**{k}** ({v})" for k, v in items[:n]) or "—"

    top_domains = s["domain_counts"].most_common(3)

    W(f"## Who This Report Is For")
    W(f"")
    W(
        f"This report turns the first system-wide mapping of CGIAR's climate data assets into "
        f"something the Hub can act on. It is written for three audiences:"
    )
    W(f"")
    W(f"- **CDH leadership and the Core team** — to see where the system is strong and where it is thin, and to steer Phase-1 priorities. *(Start with the Executive Summary and Section 5.)*")
    W(f"- **The CDH development and data team** — to decide what to federate or ingest now, what to queue for later, and where effort is being duplicated. *(Section 6.)*")
    W(f"- **Contributing centres** — to check how their assets are represented and flag corrections or additions. *(Annex A and the feedback links in the Data Access section.)*")
    W(f"")
    W(f"**The questions it answers**")
    W(f"")
    W(f"- Where is CGIAR strong, and where are the gaps — by centre, theme, and geography?")
    W(f"- Which assets should the Hub act on now, and which belong in the next cycle?")
    W(f"- What is openly reusable, foundational, or nationally important — and what is locked behind an access conversation?")
    W(f"- Where are centres independently reprocessing the same upstream climate inputs?")
    W(f"")
    W(f"**The needs it serves**")
    W(f"")
    W(
        f"The Hub exists to reduce fragmentation in CGIAR's climate evidence base. This mapping is "
        f"the evidence behind that effort: it prioritises a focused set of high-value assets for "
        f"Phase-1 inclusion or federation, surfaces reusable and nationally-relevant datasets, flags "
        f"duplicated preprocessing the Hub can do once instead of many times, and points to the "
        f"gaps — and the centres — still to engage. It is deliberately strategic, not exhaustive "
        f"(Section 1)."
    )
    W(f"")

    W(f"---")
    W(f"")
    W(f"## Executive Summary")
    W(f"")
    W(
        f"CGIAR holds a wealth of climate data — but it is scattered across centres, programmes, "
        f"and bilateral projects: hard to find, easy to duplicate, and difficult to reuse. The "
        f"Climate Data Hub was created to change that, and this exercise is its first concrete "
        f"step: a structured look at the strongest climate data assets the centres themselves put "
        f"forward."
    )
    W(f"")
    W(
        f"**{s['total']} assets from {s['n_centres']} centres** were catalogued, spanning hazard "
        f"monitoring, adaptation analytics, exposure, mitigation accounting, and integrated "
        f"multi-domain platforms; **{s['hub_total']} ({pct(s['hub_total'], s['total'])}%)** come "
        f"from the six Hub-funded centres. Coverage is deepest in **{top_domains[0][0]}** and "
        f"**{top_domains[1][0]}**, and concentrated in Africa and Global datasets."
    )
    W(f"")
    W(f"Three messages stand out:")
    W(f"")
    W(
        f"- **There are clear quick wins.** {len(s['ingest_now'])} assets are openly accessible, "
        f"technically ready, and high-value — they can be federated or ingested with little "
        f"friction (Section 6.5)."
    )
    W(
        f"- **The centres' nominations provide a strong starting point.** The "
        f"{len(s['strategic'])} top-three nominations come with written justifications and are the "
        f"primary starting set for immediate Hub consideration, but not the only assets that may "
        f"enter Phase 1 review (Section 6.2; Section 8)."
    )
    W(
        f"- **The gaps are specific and actionable.** Adaptive Capacity is essentially absent, "
        f"Latin America & Caribbean and Asia are thin, and two major centres — CIMMYT and "
        f"ICARDA — have yet to submit (Section 5; Section 7)."
    )
    W(f"")
    W(
        f"The rest of the report makes each of these concrete: where the strengths and gaps sit "
        f"(Section 5), and exactly what to do now and next (Section 6)."
    )
    W(f"")
    W(f"> **Work-in-progress caveat.** This report is one piece of evidence to guide the Climate Data Hub, alongside other technical, strategic, and governance inputs; it does **not** by itself dictate exactly what the Hub will do. The mapping is iterative and will be updated as centres review their entries, flag corrections, and suggest additions. Centres and partners will have multiple opportunities across the annual CDH cycle to engage, refine priorities, and shape what comes next.")
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
    W(
        f"The blank template, full submission guidelines, and every centre's completed Excel "
        f"workbook are version-controlled in the project repository: the raw submissions are at "
        f"[`data/submissions/`](https://github.com/CGIAR-Climate-Data-Hub/cdh-asset-mapping/tree/main/data/submissions) "
        f"and the mapping strategy and template instructions at "
        f"[`docs/CDH-Asset-Mapping-Strategy.docx`](https://github.com/CGIAR-Climate-Data-Hub/cdh-asset-mapping/blob/main/docs/CDH-Asset-Mapping-Strategy.docx)."
    )
    W(f"")
    W(f"### 2.2 Normalisation")
    W(f"")
    W(
        f"Free-text fields for climate domain, asset type, and spatial coverage were normalised "
        f"to controlled vocabularies using keyword matching. The normalisation rules are documented "
        f"in `src/ingest.py` and applied reproducibly by the pipeline documented in the "
        f"**Data Access, Feedback and Reproducibility** section."
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
    W(f"### 2.4 Optional composite priority score")
    W(f"")
    W(
        f"The mapping strategy deliberately avoids reducing the five qualitative criteria to a "
        f"single rank (Section 6.1). For navigation only — to help sort long lists in the report "
        f"and dashboard — a transparent **composite score (0–100)** is nonetheless computed. It is "
        f"defined once in `src/ingest.py` and shared verbatim with the dashboard, so the two never "
        f"diverge. It is **not** an official ranking; the authoritative signal remains each centre's "
        f"own top-three nomination."
    )
    W(f"")
    W(f"Each component is mapped to a 0–1 sub-score, then combined as a weighted average:")
    W(f"")
    W(f"- **Ordinal criteria** (Decision Relevance, Technical Readiness, Reuse Potential, Contemporary Validity, Sustainability) map Very High = 1.0, High = 0.85, Medium-High = 0.75, Medium = 0.5, Medium-Low = 0.35, Low = 0.25.")
    W(f"- **Submitted rank** maps to a *centre-relative* sub-score `(max_rank_in_centre − rank + 1) / max_rank_in_centre`, so rank 1 scores highest within each centre regardless of how many assets that centre ranked.")
    W(f"- **Intended Hub role** maps Hub-native = 1.0, Derived = 0.8, Federation = 0.7, Reference/Operational = 0.6; unspecified is omitted.")
    W(f"")
    W(f"| Component | Weight |")
    W(f"|---|---|")
    W(f"| Decision relevance | 0.20 |")
    W(f"| Technical readiness | 0.20 |")
    W(f"| Reuse potential | 0.15 |")
    W(f"| Submitted rank (within centre) | 0.15 |")
    W(f"| Contemporary validity | 0.10 |")
    W(f"| Sustainability | 0.10 |")
    W(f"| Intended Hub role specified | 0.10 |")
    W(f"")
    W(
        f"The score is the weighted mean of **only the components that are present**: a missing "
        f"criterion is dropped from both numerator and denominator rather than scored as zero, so "
        f"incomplete submissions are not unfairly penalised (they simply rest on less evidence). "
        f"The portfolio mean is **{s['mean_score']}**."
    )
    W(f"")

    W(f"---")
    W(f"")
    W(f"## 3. Domain Definitions")
    W(f"")
    W(f"The following climate domain vocabulary is used throughout this report:")
    W(f"")
    W(f"| Domain | Definition |")
    W(f"|----------------------|----------------------------------------------------------|")
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
    W(
        f"*This section describes the portfolio as a whole — how much was submitted and by whom, "
        f"which themes and geographies it covers, who owns the assets, and what they actually "
        f"contain. Sections 5 and 6 then turn this into strengths, gaps, and actions.*"
    )
    W(f"")
    W(f"### 4.1 Volume and coverage")
    W(f"")
    W(
        f"A total of **{s['total']} assets** were catalogued across {s['n_centres']} centres "
        f"(Figure 1). All figures reported here reflect post-consolidation count "
        f"(see Section 2.3 and Annex C)."
    )
    W(f"")
    W(f"<!--FIG1-->")
    W(f"")
    W(
        f"**Figure 1. Assets submitted per centre.** Total catalogued assets per centre after "
        f"consolidation (Section 2.3), ordered largest to smallest. Each bar is split into one "
        f"coloured segment per nominating individual — a longer run of colours means more "
        f"contributors behind a centre's portfolio (e.g. AfricaRice and IITA drew on many "
        f"nominators, while ILRI, IFPRI, and IRRI came through a single nominator). Segment colour "
        f"is arbitrary and carries no meaning (hence no legend); the number is the centre total. "
        f"The interactive dashboard names each nominator and their count on hover."
    )
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
    W(
        f"**Coverage caveat — centres not yet represented.** Submissions were received from "
        f"{s['n_centres']} centres. **CIMMYT** and **ICARDA** had not submitted at the time of "
        f"this build and are therefore absent from all totals and figures below; their inclusion "
        f"will materially change domain and geographic coverage (CIMMYT in particular for "
        f"South Asian wheat/maize systems and adaptation analytics — see the box in Section 5.4). "
        f"Targeted follow-up with both centres is underway."
    )
    W(f"")

    W(f"### 4.2 Domain distribution")
    W(f"")
    W(f"<!--FIG2-->")
    W(f"")
    W(
        f"**Figure 2. Distribution by climate domain.** Number of assets in each normalised "
        f"climate domain (definitions in Section 3); assets with no specified domain are excluded. "
        f"Hover a bar for its share of the portfolio, the centres contributing it, and how much is "
        f"openly accessible. Adaptation Analytics and Hazard are the largest domains; Adaptive "
        f"Capacity and Climate Policy / Finance the thinnest."
    )
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
    W(f"<!--FIG5-->")
    W(f"")
    W(
        f"**Figure 5. Centre × domain heatmap.** Number of assets each centre holds in each "
        f"single-label climate domain; darker cells hold more, blank cells none. Hover a cell for "
        f"example assets and the open-access share of that centre–domain combination. "
        f"Hybrid-domain assets are excluded here for readability but counted in Figure 2."
    )
    W(f"")
    W(
        f"Heatmap shows number of assets per centre per domain. Hybrid domain labels "
        f"(e.g. Sensitivity / Adaptation Analytics, Adaptation Analytics / Mitigation) are "
        f"excluded from heatmap for readability; they are included in Figure 2."
    )
    W(f"")

    W(f"### 4.3 Ownership and asset type")
    W(f"")
    W(f"<!--FIG3-->")
    W(f"")
    W(
        f"**Figure 3. Asset type (ownership).** Share of catalogued assets by ownership class — "
        f"CGIAR-produced, co-produced with partners, or external datasets adopted into CGIAR "
        f"workflows. Hover a bar for the centres behind it and its open-access share."
    )
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
    W(f"<!--FIG4-->")
    W(f"")
    W(
        f"**Figure 4. Geographic coverage.** Number of assets per geographic grouping; assets with "
        f"no specified coverage are excluded. Hover a bar for the dominant domains and centres in "
        f"that region. Africa and Global dominate; Latin America & Caribbean, Asia, and "
        f"Multi-regional are comparatively thin."
    )
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

    W(f"### 4.6 What the assets measure, and who uses them")
    W(f"")
    W(
        f"Counts alone understate what was captured. The submissions also describe what each asset "
        f"actually produces (template Sheet D — Thematic) and how it is used in practice (Sheet E — "
        f"Context & Use). That detail is what turns an inventory into a basis for reuse, and it "
        f"sharpens the picture of where the portfolio's real value sits."
    )
    W(f"")
    W(
        f"**What they measure.** **{s['n_output']} of {s['total']}** assets specify an output "
        f"variable type, spanning raw climate variables and hazard indices, biophysical outputs "
        f"(crop yields, biomass, soil moisture), greenhouse-gas emissions, and suitability or "
        f"classification layers. The commodity focus tracks CGIAR's mandate crops — led by "
        f"{topkw(s['commodity_kw'])} — while farming systems are dominated by "
        f"{topkw(s['farming_kw'])}. The recurring upstream climate inputs in "
        f"Section 6.7 show how many of these outputs are, in turn, built on a small shared set of "
        f"sources, which is exactly where the Hub can remove duplicated effort."
    )
    W(f"")
    W(
        f"**How they are used.** Submitters most often describe their assets serving "
        f"{topkw(s['use_kw'])} purposes — confirming a portfolio that skews decisively toward "
        f"decision support rather than purely academic output. The user communities named most "
        f"frequently are {topkw(s['user_kw'])}. Most tellingly for the Hub's reuse mandate, "
        f"**{s['n_cross_program']} assets** already name the CGIAR programmes using them, "
        f"**{s['n_high_national']}** are rated high or very-high national relevance (the datasets "
        f"that underpin country engagement and policy dialogue), and **{s['foundational_count']}** "
        f"are flagged as foundational to ongoing work — assets whose withdrawal would break "
        f"existing pipelines."
    )
    W(f"")
    W(
        f"Two implications follow. First, the portfolio's value is concentrated in a relatively "
        f"small core of foundational, multi-programme, nationally-relevant datasets; these are the "
        f"natural anchors for Phase 1, ahead of more peripheral or single-use submissions. Second, "
        f"the strong policy, advisory, and modelling orientation means the Hub's task is less to "
        f"surface new science than to make assets that are *already relied upon* discoverable, "
        f"interoperable, and durable — reducing the risk that critical datasets remain locked to "
        f"the teams that happen to maintain them today."
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
    W(f"<!--FIG6-->")
    W(f"")
    W(
        f"**Figure 6. Where coverage is deep, thin, or absent (climate domain × geography).** Each "
        f"cell counts the assets in one domain (row) and geography (column); darker blue = more "
        f"assets, a red dot = a true gap with none. Hover any cell for the exact count. Two patterns "
        f"stand out: coverage concentrates heavily in Africa and Global, and **Adaptive Capacity is "
        f"empty across every region** while **Latin America & Caribbean** and **Multi-regional** are "
        f"thin throughout — the clearest targets for the next cycle. Hybrid-domain and "
        f"unspecified-geography assets are excluded for legibility."
    )
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
    W(f"*Table — Per-centre strength profile (mean priority is the optional composite of Section 6.1).*")
    W(f"")
    W(f"| Centre | Assets | Mean priority | Domains covered | Hub-funded |")
    W(f"|---|---|---|---|---|")
    for c, st in sorted(s["centre_strength"].items(),
                        key=lambda x: -x[1]["mean_score"]):
        tag = "Yes" if c in HUB_FUNDED else "No"
        W(f"| {centre_label(c)} | {st['n']} | {st['mean_score']} | {len(st['domains'])} | {tag} |")
    W(f"")

    W(f"### 5.4 Notable assets outside this mapping")
    W(f"")
    W(
        f"Two strategically important assets are intentionally **not** ranked in the analysis "
        f"above, and should be read alongside it:"
    )
    W(f"")
    W(
        f"> **AAA Atlas (CGIAR Adaptation Atlas).** Already planned for integration into the "
        f"Climate Data Hub from the outset, the AAA Atlas has been **deliberately excluded** from "
        f"the nomination ranking so that other centre assets can surface on their own merit. Its "
        f"inclusion in the Hub is assumed, not contingent on this exercise."
    )
    W(f"")
    W(
        f"> **South Asia Adaptation Atlas (ACASA).** Developed by CIMMYT / BISA "
        f"(<https://acasa-bisa.org/>), ACASA is a major adaptation-analytics resource for South "
        f"Asian food systems. CIMMYT has not yet submitted to this mapping, so ACASA does not "
        f"appear in any totals or figures; it is flagged here as a high-priority asset to capture "
        f"once CIMMYT engages."
    )
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
        f"The **{len(s['strategic'])} assets** below are each centre's three best-ranked "
        f"submissions. Under the mapping strategy these are the unit for **immediate Hub "
        f"inclusion or federation**; lower-ranked assets are candidates for later cycles. Each "
        f"carries a centre-written justification (summarised below; full text in the asset record)."
    )
    notes = []
    if s["dup_rank_centres"]:
        notes.append(
            f"{len(s['dup_rank_centres'])} centre(s) "
            f"({', '.join(centre_label(c) for c in sorted(s['dup_rank_centres']))}) submitted "
            f"tied/duplicate ranks, so their nominations are capped at the three lowest-ranked "
            f"assets (ties broken by name)"
        )
    if s["unranked_centres"]:
        notes.append(
            f"{', '.join(centre_label(c) for c in sorted(s['unranked_centres']))} submitted no "
            f"ranks and so contribute no nominations"
        )
    notes.append("a centre with fewer than three ranked assets shows fewer")
    if notes:
        W(f"")
        W(f"*Data-quality note: {'; '.join(notes)}. To be corrected with centres next cycle.*")
    W(f"")
    W(f"*Table 1 — Strategic nominations: each centre's top-ranked assets (sortable / filterable in HTML; asset names link to the data source).*")
    W(f"")
    W(f"<!--TABLE1-->")
    W(f"")

    W(f"### 6.3 Priority quadrant")
    W(f"")
    W(f"<!--QUADRANT-->")
    W(f"")
    W(
        f"**Figure 7. Priority quadrant.** Each point is an asset placed by its submitter-rated "
        f"technical readiness (x-axis) and reuse potential (y-axis); colour shows access status "
        f"(green = Open, orange = Restricted, grey = Unknown). **Hover any point** for the asset's "
        f"name, centre, domain, access, and priority score. The shaded top-right zone holds the "
        f"natural 'quick wins' — assets that are both ready and broadly reusable. Reuse potential "
        f"and access are independent criteria, so high-reuse Restricted (orange, upper) points are "
        f"not a contradiction — they are the prime candidates for an access negotiation to unlock "
        f"that value."
    )
    W(f"")
    W(
        f"Why are several **Restricted** assets rated **high reuse**? The two are measured "
        f"independently. *Reuse potential* is the submitter's judgement of how broadly the asset's "
        f"**content** could serve other programmes, countries, or analyses; *access status* is "
        f"whether it can be **obtained** today under current licensing or permissions. A dataset can "
        f"be scientifically reusable while still gated — these are exactly the assets where a short "
        f"access conversation converts latent value into usable value (see Section 6.6)."
    )
    W(f"")

    W(f"### 6.4 Suggested integration pathway")
    W(f"")
    W(f"<!--FIG8-->")
    W(f"")
    W(
        f"**Figure 8. Suggested integration pathway.** Each asset is classified by a heuristic "
        f"combining its access status and file format into a starting pathway — federate (ready, or "
        f"with light ingest), ingest candidate, negotiate access, or assess. Hover a bar for the "
        f"file formats driving that pathway and example assets. The classification is advisory and "
        f"should be verified per asset before committing."
    )
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
        return linked(a), short_why(a)

    W(f"### 6.5 Act now — ready, open, high value")
    W(f"")
    inow = s["ingest_now"]
    W(
        f"**{len(inow)} assets** combine Open access, high technical readiness, and a priority "
        f"score of 75+. These are the recommended near-term targets for federation or ingestion "
        f"(all listed below; sort or filter the table in the HTML edition):"
    )
    W(f"")
    W(f"*Table 2 — 'Act now' shortlist: Open-access, high-readiness assets (sortable / filterable in HTML; asset names link to the data source).*")
    W(f"")
    W(f"<!--TABLE2-->")
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
    W(f"*Table 3 — 'Next cycle' queue: high-value assets blocked by access or readiness. Asset names link to the data source.*")
    W(f"")
    W(f"| Centre | Asset | Domain | Blocker | Rationale |")
    W(f"|---|---|---|---|---|")
    for a in nxt[:12]:
        name, why = action_row(a)
        blocker = ("Restricted access" if a.get("access_norm") == "Restricted"
                   else "Readiness below High")
        W(
            f"| {centre_label(a['centre'])} | {name} | "
            f"{a['domain_norm']} | {blocker} | {why} |"
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
    W(
        f"*Stepping back from the numbers: what does the portfolio tell us, how far can we trust "
        f"it, and what should happen next?*"
    )
    W(f"")
    W(f"### 7.1 Coverage and gaps")
    W(f"")
    W(
        f"This mapping captures a substantial and decision-relevant slice of CGIAR's climate data "
        f"portfolio, but by design it is neither exhaustive nor a complete census. The picture it "
        f"paints should be read as *what the engaged centres consider their strongest assets*, not "
        f"the full universe of CGIAR climate data. Two coverage caveats matter most when "
        f"interpreting the gaps below."
    )
    W(f"")
    W(
        f"First, **two centres are absent**: CIMMYT and ICARDA had not submitted at the time of "
        f"this build (Section 4.1). This is consequential, not cosmetic — CIMMYT anchors much of "
        f"CGIAR's South Asian wheat and maize adaptation analytics (including the ACASA atlas, "
        f"Section 5.4), and ICARDA anchors dryland and West Asia / North Africa systems. Several "
        f"apparent gaps below will narrow once they engage."
    )
    W(f"")
    W(
        f"Second, within the assets that *were* submitted, three gaps are robust enough to act on. "
        f"**Adaptive Capacity** is essentially absent ({s['domain_counts'].get('Adaptive Capacity', 0)} "
        f"assets) — the portfolio is strong on hazard and adaptation analytics but weak on the "
        f"social and institutional capacity to respond, a recognised blind spot for climate "
        f"targeting. **Latin America & Caribbean** and **Asia / South & SE Asia** are thin relative "
        f"to Africa and Global coverage, concentrating geographic risk. And "
        f"**{len(s['single_centre_domains'])} domain(s)** currently rest on a single centre "
        f"(Section 5.2), so the system-wide picture in those areas is one withdrawal away from a "
        f"hole. Each of these is an outreach target rather than a finding about CGIAR's true "
        f"capability — the mapping surfaces where to look next, not a verdict on what exists."
    )
    W(f"")
    W(f"### 7.2 Data quality observations")
    W(f"")
    W(
        f"The submissions are usable and rich, but several recurring data-quality issues shape how "
        f"far the analysis can be pushed, and each has a concrete fix for the next cycle."
    )
    W(f"")
    W(
        f"**Incomplete assessment fields.** Asset rank, intended Hub role, and the qualitative "
        f"ratings were left blank for a non-trivial share of assets, and only "
        f"**{s['n_reported_inputs']} of {s['total']}** recorded their underlying climate inputs — "
        f"which limits the duplication analysis (Section 6.7) more than any other gap. Mandating "
        f"the Hub-role and climate-input fields would sharply increase the analytical value of the "
        f"next round."
    )
    W(f"")
    if s["dup_rank_centres"] or s["unranked_centres"]:
        bits = []
        if s["dup_rank_centres"]:
            bits.append(
                f"{', '.join(centre_label(c) for c in sorted(s['dup_rank_centres']))} submitted "
                f"tied or duplicate ranks (e.g. several assets all ranked '1' or '2'), so their "
                f"strategic nominations were capped at the three lowest-ranked assets"
            )
        if s["unranked_centres"]:
            bits.append(
                f"{', '.join(centre_label(c) for c in sorted(s['unranked_centres']))} submitted no "
                f"ranks at all"
            )
        W(
            f"**Inconsistent ranking.** The strategy intends a clean 1..N ordering per centre, but "
            f"{'; '.join(bits)}. Ranking is the single most important field for prioritisation, so "
            f"a brief validation step with each focal point before the next submission would pay "
            f"off directly."
        )
        W(f"")
    W(
        f"**Free-text variability and AI-drafted fields.** Domain, type, and access were submitted "
        f"as free text and normalised to controlled vocabularies (Section 2.2); a handful of "
        f"entries also carried template example text or GPT-drafted descriptions that required "
        f"scrubbing or validation. This is expected given the strategy's allowance for GPT "
        f"drafting, but it reinforces that externally-researchable fields must be expert-checked, "
        f"and that internal-use and strategic-importance fields should never be GPT-generated."
    )
    W(f"")
    n_unspec_dom = sum(1 for a in assets if a["domain_norm"] == "Not specified")
    if n_unspec_dom:
        W(
            f"Finally, **{n_unspec_dom} asset(s)** had no climate domain specified and could not be "
            f"classified from context; they are retained in the inventory but excluded from the "
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
    W(
        f"What the mapping implies for sequencing is concrete. Roughly "
        f"**{s['integration_counts'].get('Federate — ready', 0) + s['integration_counts'].get('Federate or light ingest', 0)} "
        f"assets** look federation-ready or close to it and can be registered with little "
        f"engineering; **{s['integration_counts'].get('Negotiate access', 0)}** are gated behind an "
        f"access conversation and should enter a parallel, relationship-led track rather than block "
        f"the technical work; and the shared upstream inputs identified in Section 6.7 (CHIRPS, "
        f"station data, CMIP6, ERA5) argue for the Hub preprocessing these **once**, centrally, "
        f"rather than each centre repeating the work. Federation-first keeps stewardship with the "
        f"originating centres while still delivering cross-CGIAR discovery — the central tension the "
        f"Hub is designed to resolve."
    )
    W(f"")
    W(f"### 7.4 In short")
    W(f"")
    W(
        f"Returning to the questions this report set out to answer: CGIAR's catalogued climate "
        f"data is **strong on hazard and adaptation analytics, deepest in Africa and at global "
        f"scale, and anchored by a core of foundational, multi-programme, nationally-relevant "
        f"datasets** — but **thin on adaptive capacity, in Latin America and Asia, and dependent "
        f"on single centres in several domains**. For the Hub, the immediate move is clear: act on "
        f"the {len(s['ingest_now'])} open, ready, high-value assets now; use the centres' "
        f"{len(s['strategic'])} strategic nominations as the primary starting set rather than the "
        f"only filter; open access conversations for the high-value-but-restricted assets in "
        f"parallel; preprocess shared climate inputs once; and run a targeted next-round outreach "
        f"to close visible gaps, especially where current submissions likely under-represent "
        f"important domains such as adaptive capacity. The detail sits in Sections 5 and 6; this "
        f"is the throughline."
    )
    W(f"")

    W(f"---")
    W(f"")
    W(f"## 8. Next Steps")
    W(f"")
    W(f"1. **Complete outstanding submissions** — follow up with ICARDA and centres with incomplete assessment fields.")
    W(f"2. **Run targeted gap-filling outreach** — use the Q2 workshop and other CGIAR channels to identify strong but currently under-represented assets in missing domains or geographies, especially adaptive-capacity assets and gaps in Latin America and Asia.")
    W(f"3. **Prioritise assets for Hub integration** — use centre rank and Hub role to sequence technical work, but do not limit Phase 1 consideration strictly to the current top-three nominations where wider strategic value or obvious submission gaps suggest additional assets should be reviewed.")
    W(f"4. **Agree federation vs ingestion for each priority asset** — work with data owners to determine appropriate integration pathway.")
    W(f"5. **Publish asset catalogue** — make inventory available to CGIAR partners via CDH portal.")
    W(f"6. **Iterate mapping annually** — re-run pipeline as new submissions arrive.")
    W(f"")

    W(f"---")
    W(f"")
    W(f"## Acknowledgments")
    W(f"")
    W(
        f"This mapping exists only because colleagues across the centres took the time to nominate, "
        f"describe, rank, and justify their strongest climate data assets — a substantial effort on "
        f"top of busy research agendas. We are sincerely grateful to every contributor, and in "
        f"particular to the centre focal points and nominators listed below."
    )
    W(f"")
    noms = {}
    for a in assets:
        nm = a.get("nominator")
        if nm:
            first = nm.split("\n")[0].strip().rstrip(",")
            if first:
                noms.setdefault(a["centre"], set()).add(first)
    W(f"| Centre | Contributors |")
    W(f"|---|---|")
    for c in sorted(noms):
        people = "; ".join(sorted(noms[c]))
        W(f"| {centre_label(c)} | {people} |")
    W(f"")
    W(
        f"Coordination of the asset-mapping exercise is led by the Alliance of Bioversity "
        f"International & CIAT under the Climate Action Program (Critical Capacity PoD2), in "
        f"collaboration with the Climate Data Hub team and AoW1. Thanks also to the centre "
        f"contacts who fielded follow-up questions on access, format, and provenance. Any errors "
        f"of consolidation or normalisation are the compilers', not the contributors'."
    )
    W(f"")

    W(f"---")
    W(f"")
    W(f"## Data Access and Reproducibility")
    W(f"")
    W(
        f"This report is generated programmatically: every figure, table, and statistic is "
        f"computed from the normalised data, with no hand-typed numbers. The data and the code "
        f"that produces this document are version-controlled and open."
    )
    W(f"")
    W(f"**Data**")
    W(f"")
    W(f"- Normalised catalogue (one row per asset): `data/normalized/assets.json`")
    W(f"- Raw centre submissions (Excel, one per centre): `data/submissions/`")
    W(f"- Consolidation/merge log: `data/merge_log.json`")
    W(f"- Researched contact overrides: `data/contact_overrides.json`")
    W(f"")
    W(f"**Code that generates this report**")
    W(f"")
    W(f"- `src/ingest.py` — reads the Excel submissions, normalises fields, writes `data/normalized/assets.json`")
    W(f"- `src/figures.py` — generates the static figures")
    W(f"- `src/report_common.py` — computes all statistics and builds the narrative, tables, and figure captions")
    W(f"- `report.qmd` — the Quarto source for this document (the interactive figures and tables are defined here)")
    W(f"- Full repository: <{REPO_URL}>")
    W(f"")
    W(f"**Reproduce this report**")
    W(f"")
    W(f"```bash")
    W(f"pip install -r requirements.txt")
    W(f"python src/ingest.py        # Excel submissions -> data/normalized/assets.json")
    W(f"python src/figures.py       # static figures -> outputs/figures/")
    W(f"quarto render report.qmd --to html   # or: --to docx")
    W(f"```")
    W(f"")

    W(f"---")
    W(f"")
    W(f"## Feedback and Review")
    W(f"")
    W(f"### Feedback — corrections, additions, and questions")
    W(f"")
    W(
        f"Spotted an error, or know of an asset that should be included? We want to hear it. "
        f"**No GitHub account is needed** — use the feedback form; responses are routed "
        f"automatically into the project's GitHub issue tracker so every item is triaged and "
        f"resolved (pipeline documented in `FEEDBACK.md`)."
    )
    W(f"")
    if FEEDBACK_FORM_URL:
        W(f"> 📝 **[Give feedback / suggest a correction or asset]({FEEDBACK_FORM_URL})** — 2-minute form, no login.")
    else:
        W(f"> 📝 **Feedback form:** *(link to be added once the Microsoft Form is published — see `FEEDBACK.md`).*")
    W(f"")

    def _issue(title, body, labels):
        q = urllib.parse.urlencode({"title": title, "body": body, "labels": labels})
        return f"{REPO_URL}/issues/new?{q}"

    W(
        f"If you do use GitHub, you can instead open a pre-filled issue directly: "
        f"[correct a record]("
        + _issue("[correction] <asset name>",
                 "Asset name:\nCentre:\nField that is wrong:\nCorrect value:\nSource/evidence:\n",
                 "correction")
        + "), [suggest a missing asset]("
        + _issue("[new asset] <asset name>",
                 "Asset name:\nCentre / owner:\nWhat it is:\nWhy strategic / reuse potential:\nURL or contact:\n",
                 "new-asset")
        + "), or [general feedback]("
        + _issue("[feedback] <topic>", "Section:\nComment or question:\n", "feedback")
        + ")."
    )
    W(f"")
    W(f"::: {{.callout-note appearance=\"simple\"}}")
    W(f"### Current review feedback themes")
    W(f"")
    W(
        f"*Last updated: {REVIEW_FEEDBACK_UPDATED}.* This internal-review note summarises the "
        f"current open feedback themes logged in GitHub. It is included for transparency and may "
        f"change as comments are resolved; it is **not** part of the asset statistics above. Some "
        f"points from this feedback have already been incorporated into Section 8 (Next Steps)."
    )
    W(f"")
    W(f"- **Implemented in the revised recommendations** — targeted gap-filling outreach and a broader prioritisation approach that does not treat current top-three nominations as the only candidates for Phase 1 review ([#5]({REVIEW_FEEDBACK_ISSUES[1][1]}), [#6]({REVIEW_FEEDBACK_ISSUES[0][1]})).")
    W(f"- **Still open for discussion** — complement this catalogue of assets produced with evidence on which climate datasets, boundaries, and crop or land-use maps people actually use across CGIAR ([#4]({REVIEW_FEEDBACK_ISSUES[2][1]})).")
    W(f"- **Still open for discussion** — clarify governance for inclusion decisions, consider whether restricted-access assets should receive lower near-term priority, and distinguish underlying datasets from tools or catalogues ([#1]({REVIEW_FEEDBACK_ISSUES[3][1]})).")
    W(f"")
    W(
        f"Interested readers can view the live GitHub discussion: "
        f"[all open feedback issues]({REVIEW_FEEDBACK_LIST_URL}) or "
        + ", ".join(
            f"[#{num}]({url})"
            for num, url in REVIEW_FEEDBACK_ISSUES
        )
        + "."
    )
    W(f":::")
    W(f"")

    W(f"---")
    W(f"")
    W(f"## Annex A — Full asset list")
    W(f"")
    W(f"*All {s['total']} catalogued assets, sortable and filterable in the HTML edition. "
      f"Use the search box to find a centre, domain, or asset.*")
    W(f"")
    W(f"<!--ANNEXA-->")
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

    return _linkify_crossrefs(lines)


# ---------------------------------------------------------------------------
# Cross-reference hyperlinking
#   - numbered headings (## 6. / ### 6.2) get explicit ids {#sec-6} / {#sec-6-2}
#   - "Annex C" headings get {#annex-c}
#   - inline "Section 6.2" / "Annex C" mentions become links to those ids
# ---------------------------------------------------------------------------
REPO_URL = "https://github.com/CGIAR-Climate-Data-Hub/cdh-asset-mapping"
# Set this to the published Microsoft Form URL once created (see FEEDBACK.md).
# When empty, the report falls back to the GitHub issue links only.
FEEDBACK_FORM_URL = "https://forms.office.com/e/ggzDBUqymB"
REVIEW_FEEDBACK_UPDATED = "30 June 2026"
REVIEW_FEEDBACK_LIST_URL = (
    f"{REPO_URL}/issues?q=is%3Aissue+is%3Aopen+label%3Afeedback"
)
REVIEW_FEEDBACK_ISSUES = [
    (6, f"{REPO_URL}/issues/6"),
    (5, f"{REPO_URL}/issues/5"),
    (4, f"{REPO_URL}/issues/4"),
    (1, f"{REPO_URL}/issues/1"),
]


def _linkify_crossrefs(lines):
    import re
    head_num = re.compile(r"^(#{2,3}) (\d+(?:\.\d+)?)([ .].*)$")
    head_annex = re.compile(r"^(#{2,3}) Annex ([A-C])\b(.*)$")
    ref_sec = re.compile(r"\bSection (\d+(?:\.\d+)?)\b")
    ref_annex = re.compile(r"\bAnnex ([A-C])\b")
    # Backticked repo file paths -> links to the file on GitHub.
    ref_code = re.compile(r"`((?:src|data|docs|dashboard)/[\w./-]+|report\.qmd|FEEDBACK\.md|README\.md)`")

    in_fence = False
    out = []
    for ln in lines:
        if ln.lstrip().startswith("```"):
            in_fence = not in_fence
            out.append(ln)
            continue
        if ln.startswith("#"):
            m = head_num.match(ln)
            if m:
                slug = "sec-" + m.group(2).replace(".", "-")
                out.append(f"{m.group(1)} {m.group(2)}{m.group(3)} {{#{slug}}}")
                continue
            m = head_annex.match(ln)
            if m:
                out.append(f"{m.group(1)} Annex {m.group(2)}{m.group(3)} {{#annex-{m.group(2).lower()}}}")
                continue
            out.append(ln)
        elif in_fence:
            out.append(ln)
        else:
            ln = ref_sec.sub(lambda m: f"[Section {m.group(1)}](#sec-{m.group(1).replace('.', '-')})", ln)
            ln = ref_annex.sub(lambda m: f"[Annex {m.group(1)}](#annex-{m.group(1).lower()})", ln)
            ln = ref_code.sub(lambda m: f"[`{m.group(1)}`]({REPO_URL}/blob/main/{m.group(1)})", ln)
            out.append(ln)
    return "\n".join(out)


def build_markdown_report(assets, s, figures_prefix="figures"):
    lines = [
        "# CGIAR Climate Data Hub — System-Wide Climate Data Asset Mapping",
        "",
        "**Version:** 1.0.1-draft  ",
        f"**Date:** {s['today']}  ",
        "**Status:** Internal review draft",
        "",
        "---",
        "",
        build_report_body(assets, s, figures_prefix=figures_prefix),
    ]
    return "\n".join(lines)
