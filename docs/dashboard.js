/* =========================================================================
   CDH Asset Explorer — command-center dashboard
   Three views (Overview / Action / Explore) over one shared filter state.
   All scoring is read from data (ingest.py); nothing is recomputed here.
   ========================================================================= */
"use strict";

const DATA_URL = "data/assets.json";

const COL = {
  blue: "#1955A6", blueLt: "#63A9FE", green: "#033529",
  teal: "#0E9E83", gold: "#E0A11B",
  open: "#1F8A70", restricted: "#C2691C", unknown: "#7C8A99",
};
const ACCESS_COL = { Open: COL.open, Restricted: COL.restricted, Unknown: COL.unknown };
const PATHWAY = [
  { key: "Federate — ready",          col: "#2E7D52" },
  { key: "Federate or light ingest",  col: COL.teal },
  { key: "Ingest candidate",          col: COL.blueLt },
  { key: "Negotiate access",          col: COL.restricted },
  { key: "Assess",                    col: COL.unknown },
];

// Canonical ordering for the coverage matrix.
const DOMAINS = [
  "Hazard", "Hazard / Climate Services", "Exposure", "Sensitivity",
  "Adaptive Capacity", "Adaptation Analytics", "Mitigation",
  "Climate Policy / Finance", "Multi-domain",
];
const GEOS = ["Africa", "Asia / South & SE Asia", "Latin America & Caribbean", "Global", "Multi-regional"];

// Filter dimensions shown in the rail (field -> label).
const FILTER_DIMS = [
  { field: "domain_norm",     label: "Climate domain" },
  { field: "centre",          label: "Centre" },
  { field: "geo_norm",        label: "Geography" },
  { field: "type_norm",       label: "Asset type" },
  { field: "access_norm",     label: "Access status" },
  { field: "integration_hint",label: "Integration pathway" },
  { field: "hub_role_norm",   label: "Intended hub role" },
  { field: "national_relevance", label: "National relevance" },
];

const state = {
  assets: [],
  filtered: [],
  view: "overview",
  filters: {},               // field -> Set of selected values
  search: "",
  actNowOnly: false,
  queueTab: "strategic",
  quadMode: "quadrant",      // Action priority plot: "quadrant" | "beeswarm"
  flowMode: "sankey",        // Flows view: "sankey" | "network"
  sankeyDims: ["centre", "domain_norm", "integration_hint"],  // 2–3 stages
  netDims: ["centre", "domain_norm"],                          // two groups
  quadX: "technical_readiness", quadY: "reuse_potential",      // quadrant axes
  swarmX: "priority_score", swarmLane: "access_norm",          // beeswarm axis + lane
  tableSort: "priority_score",
  tableDir: "desc",
  gapRow: "domain_norm", gapCol: "geo_norm",  // coverage-map axes
  selectedCell: null,        // "domain|||geo"
  charts: {},
  netSim: null,              // active d3-force simulation (so we can stop it)
};

const VIEWS = ["overview", "explore", "flows", "action"];
FILTER_DIMS.forEach((d) => (state.filters[d.field] = new Set()));

const $ = (id) => document.getElementById(id);

/* ---------------- init ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  const res = await fetch(DATA_URL);
  state.assets = (await res.json()).map(deriveAsset);
  const hash = (location.hash || "").replace("#", "");
  if (VIEWS.includes(hash)) state.view = hash;
  const fp = new URLSearchParams(location.search).get("flow");
  if (fp === "network" || fp === "sankey") {
    state.flowMode = fp;
    document.querySelectorAll("#flowModeToggle .seg").forEach((b) => b.classList.toggle("is-active", b.dataset.flow === fp));
  }
  buildRail();
  wireChrome();
  // Seed the history entry so Back from the first in-app step returns here,
  // then push a separate entry if the URL asks for an open drawer — Back then
  // closes the drawer instead of leaving the dashboard (issue #7).
  history.replaceState({ view: state.view }, "", `#${state.view}`);
  switchView(state.view, false);
  applyFilters();
  const d = new URLSearchParams(location.search).get("asset");
  if (d != null && state.assets[+d]) openDrawer(state.assets[+d]);
});

/* View switches and the asset drawer are real navigation steps: each pushes a
   history entry, and Back walks them in reverse instead of leaving the
   dashboard (issue #7). popstate re-applies the state without pushing. */
window.addEventListener("popstate", (e) => {
  const st = e.state || urlState();
  if (st.asset != null && state.assets[st.asset]) openDrawer(state.assets[st.asset], false);
  else closeDrawer(true);
  const view = VIEWS.includes(st.view) ? st.view : "overview";
  if (view !== state.view) switchView(view, false);
});

function urlState() {
  const view = (location.hash || "").replace("#", "");
  const asset = new URLSearchParams(location.search).get("asset");
  return { view, asset: asset != null ? +asset : null };
}

function deriveAsset(a) {
  const c = { ...a };
  c.domain_norm = c.domain_norm || "Not specified";
  c.geo_norm = c.geo_norm || "Not specified";
  c.type_norm = c.type_norm || "Not specified";
  c.access_norm = c.access_norm || "Unknown";
  c.integration_hint = c.integration_hint || "Assess";
  c.hub_role_norm = c.hub_role_norm || "Unspecified";
  c.national_relevance = c.national_relevance || "Not specified";
  c.priority_score = Number.isFinite(c.priority_score) ? c.priority_score : null;
  c.sc = c.score_components || {};
  c.label = `${c.name} (${c.centre})`;
  c.blob = [c.name, c.short_description, c.centre, c.domain_norm, c.type_norm,
            c.geo_norm, c.access_norm, c.integration_hint, c.justification]
    .filter(Boolean).join(" ").toLowerCase();
  return c;
}

/* ---------------- filtering ---------------- */
function isActNow(a) {
  return a.access_norm === "Open" && (a.sc.technical_readiness ?? 0) >= 0.75 && (a.priority_score ?? 0) >= 75;
}
function isNextCycle(a) {
  return !isActNow(a) && (a.priority_score ?? 0) >= 70
    && (a.access_norm === "Restricted" || (a.sc.technical_readiness ?? 0) < 0.75);
}

function applyFilters() {
  const s = state.search;
  state.filtered = state.assets.filter((a) => {
    if (s && !a.blob.includes(s)) return false;
    for (const { field } of FILTER_DIMS) {
      const set = state.filters[field];
      if (set.size && !set.has(a[field])) return false;
    }
    if (state.actNowOnly && !isActNow(a)) return false;
    return true;
  });
  renderAll();
}

/* ---------------- rail ---------------- */
function buildRail() {
  const wrap = $("filterGroups");
  wrap.innerHTML = FILTER_DIMS.map(({ field, label }) => {
    const counts = countBy(state.assets, field);
    const values = orderValues(field, Object.keys(counts));
    const open = true;        // groups unfurled by default (discoverability)
    const chips = values.map((v) =>
      `<button type="button" class="fchip" data-field="${field}" data-value="${esc(v)}" aria-pressed="false">
         ${esc(v)}<span class="fchip-count">${counts[v]}</span></button>`).join("");
    return `<details class="filter-group" ${open ? "open" : ""}>
        <summary>${esc(label)}</summary>
        <div class="chips">${chips}</div>
      </details>`;
  }).join("");

  wrap.querySelectorAll(".fchip").forEach((btn) => {
    btn.addEventListener("click", () => toggleFilter(btn.dataset.field, btn.dataset.value));
  });
}

function toggleFilter(field, value) {
  const set = state.filters[field];
  set.has(value) ? set.delete(value) : set.add(value);
  syncRail();
  applyFilters();
}

function syncRail() {
  document.querySelectorAll(".fchip").forEach((btn) => {
    const on = state.filters[btn.dataset.field].has(btn.dataset.value);
    btn.setAttribute("aria-pressed", String(on));
  });
}

function resetAll() {
  FILTER_DIMS.forEach((d) => state.filters[d.field].clear());
  state.search = ""; $("searchInput").value = "";
  state.actNowOnly = false; setActNowBtn();
  state.selectedCell = null;
  syncRail();
  applyFilters();
}

/* ---------------- chrome (tabs, search, drawer) ---------------- */
function wireChrome() {
  $("viewNav").querySelectorAll(".viewtab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });
  $("searchInput").addEventListener("input", (e) => { state.search = e.target.value.trim().toLowerCase(); applyFilters(); });
  $("resetFilters").addEventListener("click", resetAll);
  $("actNowToggle").addEventListener("click", () => {
    state.actNowOnly = !state.actNowOnly; setActNowBtn(); applyFilters();
  });
  // The "Ready to act now" KPI card jumps straight to those assets in Explore.
  $("kpiActNowCard").addEventListener("click", () => {
    state.actNowOnly = true; setActNowBtn(); applyFilters();
    if (state.view !== "explore") switchView("explore");
  });
  $("downloadCsv").addEventListener("click", downloadCsv);
  $("tableSort").addEventListener("change", (e) => { state.tableSort = e.target.value; renderTable(); });
  document.querySelectorAll("#assetTable th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const field = th.dataset.sort;
      if (state.tableSort === field) state.tableDir = state.tableDir === "asc" ? "desc" : "asc";
      else { state.tableSort = field; state.tableDir = field === "name" || field === "centre" ? "asc" : "desc"; }
      $("tableSort").value = field;
      renderTable();
    });
  });
  $("queueToggle").querySelectorAll(".qtab").forEach((t) => {
    t.addEventListener("click", () => {
      state.queueTab = t.dataset.queue;
      $("queueToggle").querySelectorAll(".qtab").forEach((x) => x.classList.toggle("is-active", x === t));
      renderQueue();
    });
  });
  $("quadModeToggle").querySelectorAll(".seg").forEach((t) => {
    t.addEventListener("click", () => {
      state.quadMode = t.dataset.mode;
      $("quadModeToggle").querySelectorAll(".seg").forEach((x) => x.classList.toggle("is-active", x === t));
      renderQuadrant();
    });
  });
  $("flowModeToggle").querySelectorAll(".seg").forEach((t) => {
    t.addEventListener("click", () => {
      state.flowMode = t.dataset.flow;
      $("flowModeToggle").querySelectorAll(".seg").forEach((x) => x.classList.toggle("is-active", x === t));
      renderFlows();
    });
  });
  window.addEventListener("resize", debounce(() => { if (state.view === "flows") renderFlows(); }, 250));
  $("drawerClose").addEventListener("click", () => closeDrawer());
  $("drawerBackdrop").addEventListener("click", () => closeDrawer());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
}

function setActNowBtn() {
  const b = $("actNowToggle");
  b.setAttribute("aria-pressed", String(state.actNowOnly));
}

function switchView(view, push = true) {
  if (push && view !== state.view) history.pushState({ view }, "", `#${view}`);
  state.view = view;
  $("viewNav").querySelectorAll(".viewtab").forEach((t) => {
    const on = t.dataset.view === view;
    t.classList.toggle("is-active", on);
    on ? t.setAttribute("aria-current", "page") : t.removeAttribute("aria-current");
  });
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("is-active", v.dataset.view === view));
  if (view !== "flows" && state.netSim) { state.netSim.stop(); state.netSim = null; }
  // Full re-render: KPIs and active-filter chips must follow the view switch,
  // never show numbers left over from the previous view (issues #8, #9).
  renderAll();
}

/* ---------------- render orchestration ---------------- */
function renderAll() { renderKpis(); renderActiveFilters(); renderView(); }

function renderView() {
  if (state.view === "overview") renderOverview();
  else if (state.view === "action") renderAction();
  else if (state.view === "flows") renderFlows();
  else renderExplore();
}

function hasActiveFilters() {
  return state.search !== "" || state.actNowOnly
    || FILTER_DIMS.some(({ field }) => state.filters[field].size > 0);
}

// "22 of 26 assets drawn — 4 lack a <what> score." (issue #11)
function omissionNote(drawn, total, what) {
  if (drawn >= total) return `All ${total} assets in view drawn.`;
  return `${drawn} of ${total} assets drawn — ${total - drawn} lack a ${what} score.`;
}

function renderKpis() {
  // One shared filter state drives every view, KPIs included — the headline
  // numbers must never contradict the charts below them (issues #8, #9).
  const f = state.filtered;
  $("kpiAssets").textContent = f.length;
  $("kpiAssetsFoot").textContent = hasActiveFilters() ? `of ${state.assets.length} total` : "whole portfolio";
  $("kpiCentres").textContent = new Set(f.map((a) => a.centre)).size;
  const open = f.filter((a) => a.access_norm === "Open").length;
  $("kpiOpen").textContent = f.length ? `${Math.round(open / f.length * 100)}%` : "—";
  $("kpiActNow").textContent = f.filter(isActNow).length;
  const sc = f.map((a) => a.priority_score).filter((x) => x != null);
  $("kpiScore").textContent = sc.length ? Math.round(sc.reduce((s, x) => s + x, 0) / sc.length) : "—";
}

function renderActiveFilters() {
  const host = $("activeFilters");
  const chips = [];
  FILTER_DIMS.forEach(({ field }) =>
    state.filters[field].forEach((v) => chips.push({ field, value: v })));
  if (state.actNowOnly) chips.push({ special: "actnow" });
  if (state.search) chips.push({ special: "search" });

  if (!chips.length) { host.innerHTML = `<span class="afilter">Whole portfolio</span>`; return; }
  host.innerHTML = chips.map((c) => {
    if (c.special === "actnow") return `<span class="afilter">⚡ Act now<button data-clear="actnow">✕</button></span>`;
    if (c.special === "search") return `<span class="afilter">“${esc(state.search)}”<button data-clear="search">✕</button></span>`;
    return `<span class="afilter">${esc(c.value)}<button data-field="${c.field}" data-value="${esc(c.value)}">✕</button></span>`;
  }).join("");
  host.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.clear === "actnow") { state.actNowOnly = false; setActNowBtn(); }
    else if (b.dataset.clear === "search") { state.search = ""; $("searchInput").value = ""; }
    else { state.filters[b.dataset.field].delete(b.dataset.value); syncRail(); }
    applyFilters();
  }));
}

/* ================= OVERVIEW =================
   Overview reflects the same shared filter state as every other view — with
   no filters it is the whole-portfolio strategic map. Clicking any element
   drills through to Explore with that selection as the only filter. */
function renderOverview() {
  renderGapMatrix();
  renderInsights();
  renderCentreStrength();
  renderDomainChart();
  renderOwnerChart();
}

// Clear filters, apply the drill selection, jump to Explore.
function drillTo(pairs) {
  FILTER_DIMS.forEach((d) => state.filters[d.field].clear());
  pairs.forEach(([f, v]) => state.filters[f].add(v));
  state.actNowOnly = false; setActNowBtn();
  syncRail();
  applyFilters();
  switchView("explore");
}

// Axis values for the coverage map: canonical order first (so known gaps stay
// visible), then any other value present in the whole portfolio appended —
// every asset in view is counted somewhere, so the cells always sum to the
// headline (issue #10). The universe is state.assets, not the filtered set,
// so axes stay stable while filtering.
function gapAxisValues(field) {
  const present = [...new Set(state.assets.map((a) => a[field] || "Not specified"))];
  const canon = field === "domain_norm" ? DOMAINS : field === "geo_norm" ? GEOS : null;
  if (!canon) return orderValues(field, present);
  return [...canon, ...present.filter((v) => !canon.includes(v)).sort()];
}

function renderGapMatrix() {
  const f = state.filtered;
  const rf = state.gapRow, cf = state.gapCol;

  // Row/column variable selectors (any rail dimension; row ≠ column).
  const dimPairs = FILTER_DIMS.map((d) => [d.field, d.label]);
  $("gapCtrls").innerHTML =
    `<span class="fc-label">Rows</span>${priSelect("gapR", rf, dimPairs, [cf])}` +
    `<span class="fc-label">Columns</span>${priSelect("gapC", cf, dimPairs, [rf])}`;
  $("gapCtrls").querySelectorAll("select").forEach((s) => s.addEventListener("change", () => {
    state.gapRow = $("pc_gapR").value;
    state.gapCol = $("pc_gapC").value;
    renderGapMatrix();
  }));
  $("gapTitle").textContent = `Coverage map — ${dimLabel(rf).toLowerCase()} × ${dimLabel(cf).toLowerCase()}`;

  const rowVals = gapAxisValues(rf);
  const colVals = gapAxisValues(cf);
  const grid = {};
  let max = 1;
  f.forEach((a) => {
    const k = `${a[rf] || "Not specified"}|||${a[cf] || "Not specified"}`;
    grid[k] = (grid[k] || 0) + 1;
    max = Math.max(max, grid[k]);
  });

  const head = `<div class="gap-row" style="--cols:${colVals.length}">
      <div class="gap-corner"></div>
      ${colVals.map((g) => `<div class="gap-colhead">${esc(g)}</div>`).join("")}</div>`;
  const rows = rowVals.map((d) => {
    const cells = colVals.map((g) => {
      const k = `${d}|||${g}`;
      const v = grid[k] || 0;
      const t = v / max;
      const bg = v === 0 ? "" : `background:rgba(25,85,166,${0.12 + t * 0.78});color:${t > 0.5 ? "#fff" : COL.green}`;
      const cls = `gap-cell${v === 0 ? " is-zero" : ""}`;
      // Real buttons with a full-context label: keyboard-focusable and each
      // cell readable by assistive tools, not one opaque image (issue #16).
      const label = v
        ? `${d} × ${g}: ${v} asset${v === 1 ? "" : "s"} — open in Explore`
        : `${d} × ${g}: no assets — coverage gap`;
      return `<button type="button" class="${cls}" ${v ? "" : "disabled"} style="${bg}" data-d="${esc(d)}" data-g="${esc(g)}" aria-label="${esc(label)}" title="${esc(d)} × ${esc(g)}: ${v} — click to open in Explore">${v || ""}</button>`;
    }).join("");
    return `<div class="gap-row" style="--cols:${colVals.length}"><div class="gap-rowhead">${esc(d)}</div>${cells}</div>`;
  }).join("");

  $("gapMatrix").innerHTML = head + rows;
  $("gapLegend").innerHTML =
    `<span><span class="dot" style="background:rgba(25,85,166,.25)"></span>few</span>
     <span><span class="dot" style="background:${COL.blue}"></span>many</span>
     <span><span class="dot" style="background:#FBEDEA;border:1px dashed #E4B6AB"></span>gap</span>`;

  $("gapMatrix").querySelectorAll(".gap-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      if (cell.classList.contains("is-zero")) return;   // nothing to open
      drillTo([[rf, cell.dataset.d], [cf, cell.dataset.g]]);
    });
  });
}

function renderInsights() {
  const f = state.filtered;        // follows the shared filter state
  if (!f.length) { $("insightList").innerHTML = `<div class="empty">No assets in view.</div>`; return; }
  const out = [];
  const grid = {};
  f.forEach((a) => { const k = `${a.domain_norm} in ${a.geo_norm}`; grid[k] = (grid[k] || 0) + 1; });
  const top = Object.entries(grid).sort((a, b) => b[1] - a[1])[0];
  if (top) out.push(`<div class="insight insight-strong"><span class="ic">💪</span><p>Deepest coverage: <b>${esc(top[0])}</b> with <b>${top[1]}</b> assets.</p></div>`);

  // Gap insights only make sense across the full dimension — suppress them
  // when that dimension is itself filtered (everything unselected would read
  // as a "gap").
  if (!state.filters.domain_norm.size) {
    const empties = DOMAINS.filter((d) => !f.some((a) => a.domain_norm === d));
    if (empties.length) out.push(`<div class="insight insight-gap"><span class="ic">⚠️</span><p>Thematic gap — no assets at all in <b>${empties.map(esc).join(", ")}</b>.</p></div>`);
  }

  if (!state.filters.geo_norm.size) {
    const thinGeo = GEOS.map((g) => [g, f.filter((a) => a.geo_norm === g).length]).sort((a, b) => a[1] - b[1])[0];
    if (thinGeo) out.push(`<div class="insight insight-gap"><span class="ic">🌍</span><p>Thinnest geography: <b>${esc(thinGeo[0])}</b> (${thinGeo[1]} assets).</p></div>`);
  }

  const dc = {};
  f.forEach((a) => (dc[a.domain_norm] ||= new Set()).add(a.centre));
  const solo = Object.entries(dc).filter(([d, s]) => s.size === 1 && d !== "Not specified");
  if (solo.length) out.push(`<div class="insight insight-risk"><span class="ic">🎯</span><p>Concentration risk: <b>${solo.length}</b> domain(s) rest on a single centre — e.g. ${esc(solo[0][0])} (${esc([...solo[0][1]][0])}).</p></div>`);

  const open = f.filter((a) => a.access_norm === "Open").length;
  out.push(`<div class="insight insight-strong"><span class="ic">🔓</span><p><b>${Math.round(open / f.length * 100)}%</b> open access — the rest need an access conversation before federation.</p></div>`);

  $("insightList").innerHTML = out.join("");
}

const scoreColor = (s) => s >= 78 ? COL.open : s >= 65 ? COL.gold : COL.restricted;
const NOMINATOR_DISPLAY_OVERRIDES = {
  "a.urfels@cgiar.org": "Anton Urfels",
};
function displayNominator(raw) {
  const first = (raw || "").split("\n")[0].trim();
  if (!first) return "Unattributed";
  return NOMINATOR_DISPLAY_OVERRIDES[first] || first;
}

// Palette for nominator segments (identity is incidental — no legend; the
// nominator + count is revealed on hover).
const SEG_COLORS = ["#1955A6", "#1F8A70", "#E0A11B", "#63A9FE", "#C2691C",
  "#17F1BD", "#7D8CC4", "#8B5CF6", "#2E7D52", "#EC4899", "#5C6B73", "#AE6C7A"];

function renderCentreStrength() {
  const map = {};
  state.filtered.forEach((a) => {
    (map[a.centre] ||= { n: 0, sum: 0, k: 0, hub: a.hub_funded, noms: {} });
    const m = map[a.centre];
    m.n++;
    if (a.priority_score != null) { m.sum += a.priority_score; m.k++; }
    const nm = displayNominator(a.nominator);
    m.noms[nm] = (m.noms[nm] || 0) + 1;
  });
  const rows = Object.entries(map).map(([c, m]) => ({
    c, n: m.n, mean: m.k ? Math.round(m.sum / m.k) : 0, hub: m.hub,
    segs: Object.entries(m.noms).sort((a, b) => b[1] - a[1]),
  })).sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...rows.map((r) => r.n));

  $("centreStrength").innerHTML = rows.map((r) => {
    const segs = r.segs.map(([nm, cnt], i) =>
      `<span class="strength-seg" style="width:${cnt / r.n * 100}%;background:${SEG_COLORS[i % SEG_COLORS.length]}" title="${esc(nm)}: ${cnt} asset${cnt > 1 ? "s" : ""}"></span>`
    ).join("");
    const label = `${r.c}: ${r.n} assets, mean priority ${r.mean}${r.hub ? ", hub-funded" : ""} — open in Explore`;
    return `
    <button type="button" class="strength-row" data-centre="${esc(r.c)}" aria-label="${esc(label)}">
      <span class="strength-name">${r.hub ? '<span class="hub-dot" title="Hub-funded"></span>' : ""}${esc(r.c)}</span>
      <span class="strength-track"><span class="strength-fill" style="width:${Math.max(6, r.n / max * 100)}%">${segs}</span></span>
      <span class="strength-count">${r.n}</span>
      <span class="strength-badge" style="background:${scoreColor(r.mean)}" title="Mean priority score">${r.mean}</span>
    </button>`;
  }).join("");

  $("centreStrength").querySelectorAll(".strength-row").forEach((row) =>
    row.addEventListener("click", () => drillTo([["centre", row.dataset.centre]])));
}

function renderDomainChart() {
  const entries = Object.entries(countBy(state.filtered, "domain_norm")).sort((a, b) => b[1] - a[1]);
  barChart("domainChart", entries, COL.blue, (label) => drillTo([["domain_norm", label]]));
}

function renderOwnerChart() {
  // Stacked horizontal: asset type x access status (current view).
  const types = orderValues("type_norm", [...new Set(state.filtered.map((a) => a.type_norm))]);
  const accesses = ["Open", "Restricted", "Unknown"];
  const datasets = accesses.map((acc) => ({
    label: acc,
    data: types.map((t) => state.filtered.filter((a) => a.type_norm === t && a.access_norm === acc).length),
    backgroundColor: ACCESS_COL[acc],
    borderRadius: 4,
  }));
  replaceChart("ownerChart", {
    type: "bar",
    data: { labels: types, datasets },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { precision: 0 } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
      },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, padding: 8 } } },
    },
  });
}

/* ================= ACTION ================= */
function renderAction() {
  renderQuadrant();
  renderPathway();
  renderQueueCounts();
  renderQueue();
}

// Shades the top-right "quick win" quadrant (readiness & reuse both >= 0.7).
const quickWinShade = {
  id: "quickWinShade",
  beforeDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!scales.x || !chartArea) return;
    const x0 = scales.x.getPixelForValue(0.7), y0 = scales.y.getPixelForValue(0.7);
    ctx.save();
    ctx.fillStyle = "rgba(31,138,112,0.07)";
    ctx.fillRect(x0, chartArea.top, chartArea.right - x0, y0 - chartArea.top);
    ctx.fillStyle = "rgba(31,138,112,0.55)";
    ctx.font = "600 11px 'IBM Plex Sans'";
    ctx.textAlign = "right";
    ctx.fillText("QUICK WINS", chartArea.right - 8, chartArea.top + 16);
    ctx.restore();
  },
};

/* Selectable axes for the Action plots. Quadrant axes are the 0–1 quality
   components; the beeswarm X can also be the 0–100 priority score, and its
   lanes can be any low-cardinality categorical field. */
const COMP_DIMS = [
  { key: "technical_readiness", label: "Technical readiness" },
  { key: "reuse_potential", label: "Reuse potential" },
  { key: "decision_relevance", label: "Decision relevance" },
  { key: "contemporary_validity", label: "Contemporary validity" },
  { key: "sustainability", label: "Sustainability" },
];
const SWARM_X = [{ key: "priority_score", label: "Priority score", max: 100 },
  ...COMP_DIMS.map((c) => ({ ...c, max: 1 }))];
const SWARM_LANE_DIMS = ["access_norm", "integration_hint", "hub_role_norm", "type_norm", "domain_norm"];
const compLabel = (k) => COMP_DIMS.find((c) => c.key === k)?.label || k;
const swarmXVal = (a, key) => key === "priority_score" ? a.priority_score : a.sc[key];

function buildPriCtrls() {
  const host = $("priCtrls"); if (!host) return;
  if (state.quadMode === "beeswarm") {
    host.innerHTML = `<span class="fc-label">X axis</span>${priSelect("swX", state.swarmX, SWARM_X.map((d) => [d.key, d.label]))}` +
      `<span class="fc-label">lanes</span>${priSelect("swL", state.swarmLane, SWARM_LANE_DIMS.map((f) => [f, dimLabel(f)]))}`;
  } else {
    host.innerHTML = `<span class="fc-label">X axis</span>${priSelect("qX", state.quadX, COMP_DIMS.map((d) => [d.key, d.label]), [state.quadY])}` +
      `<span class="fc-label">Y axis</span>${priSelect("qY", state.quadY, COMP_DIMS.map((d) => [d.key, d.label]), [state.quadX])}`;
  }
  host.querySelectorAll("select").forEach((s) => s.addEventListener("change", onPriDimChange));
}
function priSelect(id, value, pairs, taken) {
  const opts = pairs.map(([k, l]) => {
    const dis = taken && taken.includes(k) && k !== value;
    return `<option value="${k}" ${k === value ? "selected" : ""} ${dis ? "disabled" : ""}>${esc(l)}</option>`;
  }).join("");
  return `<select class="fc-select" id="pc_${id}">${opts}</select>`;
}
function onPriDimChange() {
  if (state.quadMode === "beeswarm") { state.swarmX = $("pc_swX").value; state.swarmLane = $("pc_swL").value; }
  else { state.quadX = $("pc_qX").value; state.quadY = $("pc_qY").value; }
  renderQuadrant();
}

function renderQuadrant() {
  buildPriCtrls();
  $("quadLegend").innerHTML = Object.entries(ACCESS_COL).map(([k, v]) =>
    `<span><span class="dot" style="background:${v}"></span>${k}</span>`).join("");
  if (state.quadMode === "beeswarm") return renderBeeswarm();

  const xf = state.quadX, yf = state.quadY, lx = compLabel(xf), ly = compLabel(yf);
  const pts = { Open: [], Restricted: [], Unknown: [] };
  let drawn = 0;
  state.filtered.forEach((a) => {
    const x = a.sc[xf], y = a.sc[yf];
    if (x == null || y == null) return;
    drawn++;
    const r = 4 + (a.sc.decision_relevance ?? 0.5) * 11;
    (pts[a.access_norm] || pts.Unknown).push({
      // deterministic spread (no Math.random so points don't jump on re-render)
      x: x + jitter(a.label, 1) * 0.06,
      y: y + jitter(a.label, 2) * 0.06,
      r, asset: a,
    });
  });
  // Never omit assets silently (issue #11): say how many are drawn and why
  // the rest are not.
  $("priPlotSub").textContent =
    `${lx} × ${ly}. Bubble size = decision relevance · colour = access. Click a point for detail. `
    + omissionNote(drawn, state.filtered.length, `${lx.toLowerCase()} / ${ly.toLowerCase()}`);
  const datasets = Object.entries(pts).filter(([, v]) => v.length).map(([acc, data]) => ({
    label: acc, data, backgroundColor: hexA(ACCESS_COL[acc], 0.5), borderColor: "#fff", borderWidth: 1,
    hoverBackgroundColor: hexA(ACCESS_COL[acc], 0.95), hoverBorderColor: COL.green, hoverBorderWidth: 2,
  }));
  replaceChart("quadrant", {
    type: "bubble",
    data: { datasets },
    plugins: [quickWinShade],
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 6 } },
      onClick: (_, els) => { if (els.length) { const d = state.charts.quadrant.data.datasets[els[0].datasetIndex].data[els[0].index]; openDrawer(d.asset); } },
      scales: {
        x: { min: 0.15, max: 1.05, title: { display: true, text: `${lx} →`, color: "#6B7B88", font: { size: 11 } }, grid: { color: "#EEF2F7" }, ticks: { font: { size: 10 } } },
        y: { min: 0.15, max: 1.05, title: { display: true, text: `${ly} →`, color: "#6B7B88", font: { size: 11 } }, grid: { color: "#EEF2F7" }, ticks: { font: { size: 10 } } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.raw.asset.name} · score ${c.raw.asset.priority_score ?? "—"} · ${c.raw.asset.access_norm}` } },
      },
    },
  });
}

/* Beeswarm: chosen X axis, points dodged into lanes (chosen categorical) so
   dense clusters never overlap — every asset is individually clickable. */
function renderBeeswarm() {
  const xf = state.swarmX, lf = state.swarmLane;
  const xMeta = SWARM_X.find((d) => d.key === xf) || SWARM_X[0];
  const xLabel = xMeta.label, xMax = xMeta.max, binW = xMax > 2 ? 3 : 0.04;
  const drawn = state.filtered.filter((a) => swarmXVal(a, xf) != null).length;
  $("priPlotSub").textContent =
    `Every asset as one dot · x = ${xLabel.toLowerCase()} · lane = ${dimLabel(lf).toLowerCase()}. Dots spread so none overlap — click any for detail. `
    + omissionNote(drawn, state.filtered.length, xLabel.toLowerCase());
  const lanes = orderValues(lf, [...new Set(state.filtered.map((a) => a[lf] || "Not specified"))]);
  const laneIndex = new Map(lanes.map((v, i) => [v, lanes.length - i]));  // top lane = first
  const datasets = lanes.map((lv) => {
    const base = laneIndex.get(lv);
    const items = state.filtered
      .filter((a) => (a[lf] || "Not specified") === lv && swarmXVal(a, xf) != null)
      .sort((p, q) => swarmXVal(p, xf) - swarmXVal(q, xf));
    const counts = {}, data = [];
    items.forEach((a) => {
      const xv = swarmXVal(a, xf);
      const b = Math.round(xv / binW);
      const k = (counts[b] = (counts[b] || 0) + 1) - 1;
      const off = Math.ceil(k / 2) * 0.16 * (k % 2 ? 1 : -1);
      data.push({ x: xv, y: base + off, asset: a });
    });
    const col = dimColor(lf, lv);
    return { label: lv, data, backgroundColor: hexA(col, 0.7), borderColor: "#fff", borderWidth: 1,
      hoverBackgroundColor: col, hoverBorderColor: COL.green, hoverBorderWidth: 2, pointRadius: 6, pointHoverRadius: 8 };
  }).filter((d) => d.data.length);
  replaceChart("quadrant", {
    type: "scatter",
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (_, els) => { if (els.length) { const d = state.charts.quadrant.data.datasets[els[0].datasetIndex].data[els[0].index]; openDrawer(d.asset); } },
      scales: {
        x: { min: 0, max: xMax === 100 ? 100 : 1.05, title: { display: true, text: `${xLabel} →`, color: "#6B7B88", font: { size: 11 } }, grid: { color: "#EEF2F7" }, ticks: { font: { size: 10 } } },
        y: { min: 0.3, max: lanes.length + 0.7, grid: { display: false },
          ticks: { stepSize: 1, font: { size: 11 }, color: COL.green, autoSkip: false,
            callback: (v) => lanes[lanes.length - v] || "" } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.raw.asset.name} · score ${c.raw.asset.priority_score ?? "—"} · ${c.raw.asset.access_norm}` } },
      },
    },
  });
}

function renderPathway() {
  const counts = countBy(state.filtered, "integration_hint");
  const total = state.filtered.length || 1;
  $("pathwayBars").innerHTML = PATHWAY.filter((p) => counts[p.key]).map((p) => {
    const v = counts[p.key];
    const on = state.filters.integration_hint.has(p.key);
    return `<button type="button" class="pbar" data-value="${esc(p.key)}" aria-pressed="${on}" aria-label="${esc(p.key)}: ${v} assets (${Math.round(v / total * 100)}%) — toggle filter">
      <span class="pbar-top"><span>${esc(p.key)}</span><b>${v} · ${Math.round(v / total * 100)}%</b></span>
      <span class="pbar-track"><span class="pbar-fill" style="width:${v / total * 100}%;background:${p.col}"></span></span>
    </button>`;
  }).join("") || `<div class="empty">No assets in view.</div>`;
  $("pathwayBars").querySelectorAll(".pbar").forEach((b) =>
    b.addEventListener("click", () => toggleFilter("integration_hint", b.dataset.value)));
}

function renderQueueCounts() {
  $("qStratCount").textContent = state.filtered.filter((a) => a.is_top3_in_centre).length;
  $("qNowCount").textContent = state.filtered.filter(isActNow).length;
  $("qNextCount").textContent = state.filtered.filter(isNextCycle).length;
}

function renderQueue() {
  const tab = state.queueTab;
  let list;
  if (tab === "strategic") {
    list = state.filtered.filter((a) => a.is_top3_in_centre)
      .sort((a, b) => a.centre.localeCompare(b.centre) || (a.asset_rank_num ?? 99) - (b.asset_rank_num ?? 99));
  } else {
    list = state.filtered.filter(tab === "now" ? isActNow : isNextCycle)
      .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));
  }
  const host = $("actionQueue");
  if (!list.length) {
    const hint = tab === "strategic" ? "No top-3 nominations in this filter."
      : tab === "now" ? "Loosen filters or check Next cycle." : "";
    host.innerHTML = `<div class="empty">No assets match. ${hint}</div>`;
    return;
  }

  host.innerHTML = list.map((a) => {
    const why = a.justification || a.primary_use_case || a.short_description || "";
    const lead = tab === "strategic"
      ? `<span class="pill pill-top">★ Rank ${esc(a.asset_rank || "—")} in ${esc(a.centre)}</span>`
      : (a.is_top3_in_centre ? '<span class="pill pill-top">top-3</span>' : "");
    const blocker = tab === "next" ? (a.access_norm === "Restricted"
      ? `<div class="qcard-blocker">⛔ Restricted access</div>`
      : `<div class="qcard-blocker">⛔ Readiness below High</div>`) : "";
    return `<article class="qcard" data-label="${esc(a.label)}" tabindex="0">
      <div class="qscore">${a.priority_score ?? "—"}<small>${tab === "strategic" ? "score·aid" : "score"}</small></div>
      <div>
        <h4>${esc(a.name)} ${lead}</h4>
        <div class="qcard-meta">${esc(a.centre)} · ${esc(a.domain_norm)} · ${esc(a.geo_norm)}</div>
        <div class="qcard-why">${esc(why)}</div>
        <div class="qcard-pills">
          <span class="pill ${accClass(a)}">${esc(a.access_norm)}</span>
          <span class="pill">${esc(a.integration_hint)}</span>
          ${a.national_relevance ? `<span class="pill">Nat'l: ${esc(a.national_relevance)}</span>` : ""}
        </div>${blocker}
      </div></article>`;
  }).join("");
  host.querySelectorAll(".qcard").forEach((card) => {
    card.addEventListener("click", () => openDrawer(byLabel(card.dataset.label)));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(byLabel(card.dataset.label)); }
    });
  });
}

/* ================= FLOWS =================
   Two relational views the static report can't show, both driven by the
   current filter and by user-chosen dimensions (selectors above the canvas):
     · Sankey  — assets flowing across 2–3 chosen categorical dimensions.
     · Network — bipartite of two chosen dimensions; values linked when assets
                 share both (coordination targets vs concentration risk). */
function renderFlows() {
  if (state.netSim) { state.netSim.stop(); state.netSim = null; }
  const host = $("flowCanvas");
  host.innerHTML = "";
  const empty = !state.filtered.length;
  $("flowEmpty").hidden = !empty;
  host.hidden = empty;
  buildFlowControls();
  if (empty) { $("flowLegend").innerHTML = ""; return; }
  if (typeof d3 === "undefined") { host.innerHTML = `<div class="empty">Flow library failed to load (offline?).</div>`; return; }
  if (state.flowMode === "network") renderNetwork(host);
  else renderSankey(host);
}

function flowDims(host) {
  const w = Math.max(320, host.clientWidth || 900);
  return { w, h: state.flowMode === "network" ? 560 : 520 };
}

/* ---- user-chosen dimensions ---- */
// The sensible categorical fields to flow/connect by (reuse the curated rail dims).
function dimLabel(field) { return FILTER_DIMS.find((d) => d.field === field)?.label || field; }

function buildFlowControls() {
  const host = $("flowControls");
  if (state.flowMode === "network") {
    const [a, b] = state.netDims;
    host.innerHTML = `<span class="fc-label">Connect</span>${flowSelect("net0", a, [b])}` +
      `<span class="fc-label">with</span>${flowSelect("net1", b, [a])}`;
  } else {
    const [s0, s1, s2] = [state.sankeyDims[0], state.sankeyDims[1], state.sankeyDims[2] || ""];
    host.innerHTML = `<span class="fc-label">Flow</span>${flowSelect("sk0", s0, [s1, s2])}` +
      `<span class="fc-arrow">→</span>${flowSelect("sk1", s1, [s0, s2])}` +
      `<span class="fc-arrow">→</span>${flowSelect("sk2", s2, [s0, s1], true)}`;
  }
  host.querySelectorAll("select").forEach((sel) => sel.addEventListener("change", onFlowDimChange));
}
function flowSelect(id, value, taken, allowNone) {
  const opts = (allowNone ? `<option value="">(none)</option>` : "") +
    FILTER_DIMS.map((d) => {
      const dis = taken.includes(d.field) && d.field !== value;
      return `<option value="${d.field}" ${d.field === value ? "selected" : ""} ${dis ? "disabled" : ""}>${esc(d.label)}</option>`;
    }).join("");
  return `<select class="fc-select" id="fc_${id}">${opts}</select>`;
}
function onFlowDimChange() {
  if (state.flowMode === "network") {
    state.netDims = [$("fc_net0").value, $("fc_net1").value];
  } else {
    state.sankeyDims = [$("fc_sk0").value, $("fc_sk1").value, $("fc_sk2").value].filter(Boolean);
  }
  renderFlows();
}

/* Stable colour for any dimension value (special palettes for the dims that
   carry meaning; hashed palette otherwise so values stay visually distinct). */
const _palMemo = {};
function palette(key) {
  if (_palMemo[key] == null) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    _palMemo[key] = SEG_COLORS[h % SEG_COLORS.length];
  }
  return _palMemo[key];
}
function dimColor(field, value) {
  if (field === "centre") return centreColor(value);
  if (field === "integration_hint") return PATHWAY.find((p) => p.key === value)?.col || COL.unknown;
  if (field === "access_norm") return ACCESS_COL[value] || COL.unknown;
  return palette(`${field}::${value}`);
}

/* ---- Sankey: user-chosen stages (2–3 categorical dimensions) ---- */
function renderSankey(host) {
  const dims = state.sankeyDims.filter(Boolean);
  $("flowTitle").textContent = `Flows — ${dims.map(dimLabel).join(" → ").toLowerCase()}`;
  $("flowSub").textContent = "Assets flowing across the chosen dimensions (current filter). Hover a node to trace its flow; click to filter Explore. Change the columns with the selectors above.";
  if (dims.length < 2) { host.innerHTML = `<div class="empty">Pick at least two dimensions to flow between.</div>`; $("flowLegend").innerHTML = ""; return; }
  const { w, h } = flowDims(host);
  const nodes = [], index = new Map();
  function node(stage, field, name) {
    const k = `${stage}:${name}`;
    if (!index.has(k)) { index.set(k, nodes.length); nodes.push({ name, stage, field }); }
    return index.get(k);
  }
  const linkMap = new Map();
  const addLink = (s, t) => {
    const key = `${s}-${t}`;
    let l = linkMap.get(key);
    if (!l) { l = { source: s, target: t, value: 0 }; linkMap.set(key, l); }
    l.value++;
  };
  state.filtered.forEach((a) => {
    const vals = dims.map((f) => a[f] || "Not specified");
    for (let i = 0; i < dims.length - 1; i++) {
      addLink(node(i, dims[i], vals[i]), node(i + 1, dims[i + 1], vals[i + 1]));
    }
  });
  const links = [...linkMap.values()];

  const sankey = d3.sankey()
    .nodeWidth(15).nodePadding(11)
    .extent([[6, 8], [w - 6, h - 8]]);
  const graph = sankey({ nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) });

  const svg = d3.select(host).append("svg").attr("width", w).attr("height", h).attr("class", "flow-svg");
  const nodeColor = (n) => dimColor(n.field, n.name);
  // Ribbon carries its source node's colour, so every column reads as colour.
  const linkColor = (l) => dimColor(l.source.field, l.source.name);
  const LINK_OP = 0.4;

  const linkSel = svg.append("g").attr("fill", "none").selectAll("path")
    .data(graph.links).join("path")
    .attr("d", d3.sankeyLinkHorizontal())
    .attr("stroke", linkColor)
    .attr("stroke-opacity", LINK_OP)
    .attr("stroke-width", (d) => Math.max(1, d.width))
    .on("mousemove", (e, d) => showTip(`<b>${esc(d.source.name)}</b> → <b>${esc(d.target.name)}</b><br>${d.value} asset${d.value > 1 ? "s" : ""}`, e))
    .on("mouseleave", hideTip);

  // Hover a node → trace its whole flow: connected ribbons brighten, rest fade.
  const touches = (l, n) => l.source === n || l.target === n;
  function highlight(n) {
    linkSel.attr("stroke-opacity", (l) => touches(l, n) ? 0.78 : 0.06);
    rectSel.attr("opacity", (m) => m === n || graph.links.some((l) => touches(l, n) && touches(l, m)) ? 1 : 0.28);
  }
  function clearHighlight() {
    linkSel.attr("stroke-opacity", LINK_OP);
    rectSel.attr("opacity", 1);
  }

  const gnode = svg.append("g").selectAll("g").data(graph.nodes).join("g");
  const rectSel = gnode.append("rect")
    .attr("x", (d) => d.x0).attr("y", (d) => d.y0)
    .attr("width", (d) => d.x1 - d.x0).attr("height", (d) => Math.max(1, d.y1 - d.y0))
    .attr("fill", nodeColor).attr("rx", 2)
    .style("cursor", "pointer")
    .on("mouseenter", (e, d) => highlight(d))
    .on("mousemove", (e, d) => showTip(`<b>${esc(d.name)}</b><br>${d.value} asset${d.value > 1 ? "s" : ""}` + (d.field ? "<br><i>click to filter</i>" : ""), e))
    .on("mouseleave", () => { hideTip(); clearHighlight(); })
    .on("click", (e, d) => { hideTip(); if (d.field) drillTo([[d.field, d.name]]); });

  gnode.append("text")
    .attr("x", (d) => d.x0 < w / 2 ? d.x1 + 6 : d.x0 - 6)
    .attr("y", (d) => (d.y0 + d.y1) / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", (d) => d.x0 < w / 2 ? "start" : "end")
    .attr("class", "flow-nodelabel")
    .text((d) => (d.y1 - d.y0) > 9 ? d.name : "");

  // Legend: name each column; show the meaning-bearing palettes if present.
  const parts = dims.map((f, i) => `<span class="flow-stat">${i + 1}. ${esc(dimLabel(f))}</span>`);
  if (dims.includes("integration_hint"))
    parts.push(...PATHWAY.map((p) => `<span><span class="dot" style="background:${p.col}"></span>${esc(p.key)}</span>`));
  else if (dims.includes("access_norm"))
    parts.push(...Object.entries(ACCESS_COL).map(([k, v]) => `<span><span class="dot" style="background:${v}"></span>${esc(k)}</span>`));
  parts.push(`<span class="flow-hint">ribbon colour follows the left column</span>`);
  $("flowLegend").innerHTML = parts.join("");
}

/* ---- Network: bipartite of two user-chosen dimensions ----
   Two values are linked when assets share both. A right-side value pulled by
   many left-side values is a coordination target; one with a single link is
   concentration risk. A relational angle the report's static matrix can't give. */
function renderNetwork(host) {
  const [fa, fb] = state.netDims;
  if (!fa || !fb || fa === fb) { host.innerHTML = `<div class="empty">Pick two different dimensions to connect.</div>`; $("flowLegend").innerHTML = ""; return; }
  const la = dimLabel(fa), lb = dimLabel(fb);
  $("flowTitle").textContent = `Network — ${la.toLowerCase()} ↔ ${lb.toLowerCase()}`;
  $("flowSub").textContent = `${la} and ${lb} values, linked when assets share both; line thickness = how many. A ${lb.toLowerCase()} pulled by several ${la.toLowerCase()} values is a coordination target; one with a single link is concentration risk. Hover or click a node to trace it; double-click to filter Explore.`;
  const { w, h } = flowDims(host);

  const edgeMap = new Map();   // "aVal|||bVal" -> count
  const aTot = {}, bTot = {}, bGroups = {};
  state.filtered.forEach((a) => {
    const av = a[fa] || "Not specified", bv = a[fb] || "Not specified";
    edgeMap.set(`${av}|||${bv}`, (edgeMap.get(`${av}|||${bv}`) || 0) + 1);
    aTot[av] = (aTot[av] || 0) + 1;
    bTot[bv] = (bTot[bv] || 0) + 1;
    (bGroups[bv] ||= new Set()).add(av);
  });
  const nodes = [], nIdx = new Map();
  const addNode = (side, field, name) => {
    const id = `${side}:${name}`;
    if (!nIdx.has(id)) {
      const tot = (side === "a" ? aTot[name] : bTot[name]) || 0;
      nIdx.set(id, nodes.length);
      nodes.push({ id, side, field, name, tot, r: 7 + Math.sqrt(tot) * 3.2 });
    }
    return nIdx.get(id);
  };
  const links = [...edgeMap.entries()].map(([k, v]) => {
    const [av, bv] = k.split("|||");
    return { source: addNode("a", fa, av), target: addNode("b", fb, bv), v };
  });

  const svg = d3.select(host).append("svg").attr("width", w).attr("height", h).attr("class", "flow-svg");
  const link = svg.append("g").attr("stroke", "#B8C4D0").selectAll("line")
    .data(links).join("line")
    .attr("stroke-width", (d) => Math.max(1, Math.min(6, d.v)))
    .attr("stroke-opacity", 0.45)
    .on("mousemove", (e, d) => showTip(`<b>${esc(d.source.name)}</b> → <b>${esc(d.target.name)}</b><br>${d.v} asset${d.v > 1 ? "s" : ""}`, e))
    .on("mouseleave", hideTip);

  // Adjacency for neighbourhood tracing. NB: at this point link.source/target
  // are still numeric indices — d3.forceLink rewrites them to node objects
  // later — so resolve through nodes[] here.
  const neighbours = new Map(nodes.map((n) => [n, new Set([n])]));
  links.forEach((l) => {
    const s = nodes[l.source], t = nodes[l.target];
    neighbours.get(s).add(t); neighbours.get(t).add(s);
  });
  let focus = null;   // pinned node (click) — survives mouse-out

  const g = svg.append("g").selectAll("g").data(nodes).join("g").style("cursor", "pointer")
    .on("mouseenter", (e, d) => { if (!focus) paint(d); })
    .on("mousemove", (e, d) => showTip(
      d.side === "a"
        ? `<b>${esc(d.name)}</b><br>${d.tot} asset${d.tot > 1 ? "s" : ""}`
        : `<b>${esc(d.name)}</b><br>${d.tot} asset${d.tot > 1 ? "s" : ""} · ${bGroups[d.name]?.size || 0} ${esc(la.toLowerCase())} value${(bGroups[d.name]?.size || 0) > 1 ? "s" : ""}`, e))
    .on("mouseleave", () => { hideTip(); if (!focus) paint(null); })
    // Single click pins/unpins focus IN PLACE (no tab jump); double-click filters.
    .on("click", (e, d) => { e.stopPropagation(); focus = focus === d ? null : d; paint(focus); })
    .on("dblclick", (e, d) => { e.stopPropagation(); hideTip(); drillTo([[d.field, d.name]]); });
  svg.on("click", () => { focus = null; paint(null); });
  g.append("circle")
    .attr("r", (d) => d.r)
    .attr("fill", (d) => dimColor(d.field, d.name))
    .attr("stroke", "#fff").attr("stroke-width", 1.5);
  g.append("text")
    .attr("class", "flow-nodelabel")
    .attr("text-anchor", "middle")
    .attr("dy", (d) => d.r + 12)
    .text((d) => d.side === "b" || d.tot >= 8 ? d.name : "");

  // Brighten a node + its neighbours and incident links; fade the rest.
  function paint(n) {
    const near = n ? neighbours.get(n) : null;
    g.attr("opacity", (d) => !near || near.has(d) ? 1 : 0.12);
    link.attr("stroke-opacity", (l) => !near ? 0.45 : (l.source === n || l.target === n) ? 0.85 : 0.04)
        .attr("stroke", (l) => near && (l.source === n || l.target === n) ? COL.green : "#B8C4D0");
  }

  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d, i) => i).distance(70).strength(0.5))
    .force("charge", d3.forceManyBody().strength(-260))
    .force("center", d3.forceCenter(w / 2, h / 2))
    .force("collide", d3.forceCollide().radius((d) => d.r + 14))
    .on("tick", () => {
      link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y)
          .attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
      g.attr("transform", (d) => `translate(${d.x = Math.max(d.r, Math.min(w - d.r, d.x))},${d.y = Math.max(d.r + 4, Math.min(h - d.r - 12, d.y))})`);
    });
  state.netSim = sim;
  g.call(d3.drag()
    .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

  const multi = Object.values(bGroups).filter((s) => s.size >= 3).length;
  const solo = Object.values(bGroups).filter((s) => s.size === 1).length;
  $("flowLegend").innerHTML =
    `<span class="flow-stat">${la} ↔ ${lb}</span>` +
    `<span class="flow-stat">${multi} ${esc(lb.toLowerCase())} value${multi === 1 ? "" : "s"} span ≥3</span>` +
    `<span class="flow-stat">${solo} on a single link</span>` +
    `<span class="flow-hint">node size = assets · click to trace · double-click to filter · drag to reposition</span>`;
}

/* SVG tooltip (shared by sankey + network) */
function showTip(html, e) {
  const tip = $("flowTip");
  tip.innerHTML = html; tip.hidden = false;
  tip.style.left = `${e.clientX + 14}px`;
  tip.style.top = `${e.clientY + 14}px`;
}
function hideTip() { $("flowTip").hidden = true; }

/* Stable per-centre colour map (sorted for determinism). */
let CENTRE_COLORS = null;
function centreColor(c) {
  if (!CENTRE_COLORS) {
    CENTRE_COLORS = {};
    [...new Set(state.assets.map((a) => a.centre))].sort()
      .forEach((name, i) => { CENTRE_COLORS[name] = SEG_COLORS[i % SEG_COLORS.length]; });
  }
  return CENTRE_COLORS[c] || COL.unknown;
}

/* ================= EXPLORE ================= */
function renderExplore() { renderTable(); }

function renderTable() {
  $("exploreCount").textContent = state.filtered.length;
  const dir = state.tableDir === "asc" ? 1 : -1;
  const rows = [...state.filtered].sort((a, b) => cmp(a[state.tableSort], b[state.tableSort]) * dir);
  document.querySelectorAll("#assetTable th.sortable").forEach((th) => {
    const on = th.dataset.sort === state.tableSort;
    th.setAttribute("aria-sort", on ? (state.tableDir === "asc" ? "ascending" : "descending") : "none");
    th.dataset.dir = on ? state.tableDir : "";
  });
  const tb = $("assetTable").querySelector("tbody");
  if (!rows.length) { tb.innerHTML = `<tr><td colspan="8"><div class="empty">No assets match current filters.</div></td></tr>`; return; }
  tb.innerHTML = rows.map((a) => `
    <tr data-label="${esc(a.label)}" tabindex="0">
      <td class="td-name"><strong>${esc(a.name)}</strong><small>${a.hub_funded ? "Hub-funded" : "Non-hub"}${a.foundational ? " · foundational" : ""}</small></td>
      <td>${esc(a.centre)}</td>
      <td>${esc(a.domain_norm)}</td>
      <td>${esc(a.geo_norm)}</td>
      <td>${esc(a.type_norm)}</td>
      <td class="num">${a.priority_score ?? "—"}</td>
      <td><span class="pill ${accClass(a)}">${esc(a.access_norm)}</span></td>
      <td>${esc(a.integration_hint)}</td>
    </tr>`).join("");
  tb.querySelectorAll("tr[data-label]").forEach((tr) => {
    tr.addEventListener("click", () => openDrawer(byLabel(tr.dataset.label)));
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(byLabel(tr.dataset.label)); }
    });
  });
}

/* ================= DRAWER ================= */
function openDrawer(a, push = true) {
  if (!a) return;
  const comp = [
    ["Decision relevance", a.sc.decision_relevance, a.decision_relevance_norm],
    ["Technical readiness", a.sc.technical_readiness, a.technical_readiness_norm],
    ["Reuse potential", a.sc.reuse_potential, a.reuse_potential_norm],
    ["Contemporary validity", a.sc.contemporary_validity, a.contemporary_validity_norm],
    ["Sustainability", a.sc.sustainability, a.sustainability_norm],
  ];
  const bars = comp.filter(([, v]) => v != null).map(([k, v, lbl]) =>
    `<div class="score-bar"><span>${k}</span><div class="sb-track"><div class="sb-fill" style="width:${v * 100}%"></div></div><span>${lbl || ""}</span></div>`).join("");

  $("drawerBody").innerHTML = `
    <div class="drawer-title">${esc(a.name)}</div>
    ${a.priority_score != null ? `<div class="drawer-score" title="Optional composite — a sort aid, not an official ranking">${a.priority_score}<small>/100 · sort aid</small></div>` : ""}
    <div class="drawer-pills">
      <span class="pill ${accClass(a)}">${esc(a.access_norm)}</span>
      <span class="pill">${esc(a.integration_hint)}</span>
      <span class="pill">${esc(a.hub_role_norm)}</span>
      ${a.is_top3_in_centre ? '<span class="pill pill-top">top-3 in centre</span>' : ""}
      ${a.foundational ? '<span class="pill">foundational</span>' : ""}
    </div>
    <p class="drawer-desc">${esc(a.short_description || "No description provided.")}</p>
    ${bars ? `<div class="drawer-group"><h5>Quality components</h5><div class="score-bars">${bars}</div></div>` : ""}
    ${a.justification ? `<div class="drawer-group"><h5>Nominator justification</h5><p class="drawer-desc" style="margin:0">${esc(a.justification)}</p></div>` : ""}
    <div class="drawer-group"><h5>Classification</h5>
      ${row("Centre", a.centre)}${row("Climate domain", a.domain_norm)}${row("Asset type", a.type_norm)}
      ${row("Geography", a.geo_norm)}${row("Submitted rank (in centre)", a.asset_rank)}</div>
    <div class="drawer-group"><h5>Scope &amp; structure</h5>
      ${row("Commodity", a.commodity)}${row("Farming system", a.farming_system)}
      ${row("Output variable", a.output_variable_type)}${row("Climate inputs", a.primary_climate_inputs)}
      ${row("Spatial coverage", a.spatial_coverage)}${row("Spatial resolution", a.spatial_resolution)}
      ${row("Temporal type", a.temporal_type)}${row("File format", a.file_format)}
      ${row("Year last updated", a.year_last_updated)}${row("Actively maintained", yn(a.actively_maintained))}</div>
    <div class="drawer-group"><h5>Use &amp; relevance</h5>
      ${row("Primary use case", a.primary_use_case)}${row("User groups", a.user_groups)}
      ${row("CGIAR programmes using", a.cgiar_programs)}${row("Partners / projects", a.partners)}
      ${row("National relevance", a.national_relevance)}</div>
    <div class="drawer-group"><h5>Context</h5>
      ${row("Nominator", displayNominator(a.nominator))}${row("Organisation", a.asset_organization)}</div>
    <div class="drawer-group"><h5>Access &amp; contact</h5>
      <div class="drawer-actions">
        ${a.url ? `<a class="drawer-cta" href="${esc(a.url)}" target="_blank" rel="noopener">🔗 Open data source ↗</a>`
                : `<span class="drawer-cta is-disabled">No data URL provided</span>`}
        ${a.contact_email ? `<a class="drawer-cta secondary" href="mailto:${esc(a.contact_email)}?subject=${encodeURIComponent("CDH asset: " + a.name)}">✉ Email contact</a>` : ""}
      </div>
      ${row("Primary contact", a.primary_contact)}${row("Contact email", a.contact_email)}
      ${a.contact_email_confidence === "inferred" ? `<p class="drawer-note">⚠ Email inferred from centre naming pattern — verify before sending.</p>` : ""}</div>
  `;
  $("drawer").classList.add("is-open");
  $("drawer").setAttribute("aria-hidden", "false");
  $("drawerBackdrop").hidden = false;
  $("drawerClose").focus();
  if (push) {
    const i = state.assets.indexOf(a);
    history.pushState({ view: state.view, asset: i }, "", `?asset=${i}#${state.view}`);
  }
}
function closeDrawer(viaHistory = false) {
  if (!$("drawer").classList.contains("is-open")) return;
  // Opened via a pushed history entry: step back and let popstate close it,
  // so ✕ / Escape / backdrop and the browser Back button stay in sync (#7).
  if (!viaHistory && history.state && history.state.asset != null) { history.back(); return; }
  $("drawer").classList.remove("is-open");
  $("drawer").setAttribute("aria-hidden", "true");
  $("drawerBackdrop").hidden = true;
}
function row(k, v) { return v ? `<div class="drawer-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>` : ""; }
function yn(v) { return v === true ? "Yes" : v === false ? "No" : null; }

/* ================= shared chart + helpers ================= */
function barChart(canvasId, entries, color, onClick) {
  replaceChart(canvasId, {
    type: "bar",
    data: { labels: entries.map((e) => e[0]), datasets: [{ data: entries.map((e) => e[1]), backgroundColor: color, borderRadius: 6 }] },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      onClick: (_, els, chart) => { if (onClick && els.length) onClick(chart.data.labels[els[0].index]); },
      scales: { x: { grid: { display: false } }, y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.x} assets` } } },
    },
  });
}

function replaceChart(key, config) {
  if (state.charts[key]) state.charts[key].destroy();
  state.charts[key] = new Chart($(key), config);
}

function downloadCsv() {
  const cols = ["name", "centre", "domain_norm", "geo_norm", "type_norm", "priority_score",
    "access_norm", "integration_hint", "hub_role_norm", "asset_rank", "url",
    "primary_contact", "contact_email", "short_description"];
  const csv = [cols.join(",")].concat(state.filtered.map((a) =>
    cols.map((c) => `"${String(a[c] ?? "").replaceAll('"', '""')}"`).join(","))).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "cdh_assets_filtered.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function countBy(arr, field) {
  return arr.reduce((acc, a) => { const k = a[field] || "Not specified"; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
}
function orderValues(field, values) {
  const canon = field === "domain_norm" ? DOMAINS : field === "geo_norm" ? GEOS
    : field === "integration_hint" ? PATHWAY.map((p) => p.key) : null;
  if (canon) return [...values].sort((a, b) => idx(canon, a) - idx(canon, b) || a.localeCompare(b));
  return [...values].sort((a, b) => a.localeCompare(b));
}
function idx(arr, v) { const i = arr.indexOf(v); return i === -1 ? 999 : i; }
function accClass(a) { return a.access_norm === "Open" ? "pill-open" : a.access_norm === "Restricted" ? "pill-restricted" : "pill-unknown"; }
function byLabel(label) { return state.assets.find((a) => a.label === label); }
function cmp(a, b) {
  const x = a ?? -Infinity, y = b ?? -Infinity;
  if (typeof x === "number" && typeof y === "number") return x - y;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true });
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function esc(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
// Deterministic [-0.5,0.5] jitter from a string key + salt (stable across renders).
function jitter(key, salt) {
  let h = salt * 2654435761;
  for (let i = 0; i < key.length; i++) h = (h ^ key.charCodeAt(i)) * 16777619 >>> 0;
  return (h % 1000) / 1000 - 0.5;
}
function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
