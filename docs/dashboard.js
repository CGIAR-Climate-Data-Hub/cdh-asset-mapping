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
  tableSort: "priority_score",
  tableDir: "desc",
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
  buildRail();
  wireChrome();
  switchView(state.view);
  applyFilters();
  const d = new URLSearchParams(location.search).get("asset");
  if (d != null && state.assets[+d]) openDrawer(state.assets[+d]);
});

function deriveAsset(a) {
  const c = { ...a };
  c.domain_norm = c.domain_norm || "Not specified";
  c.geo_norm = c.geo_norm || "Not specified";
  c.type_norm = c.type_norm || "Not specified";
  c.access_norm = c.access_norm || "Unknown";
  c.integration_hint = c.integration_hint || "Assess";
  c.hub_role_norm = c.hub_role_norm || "Unspecified";
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
  $("drawerClose").addEventListener("click", closeDrawer);
  $("drawerBackdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
}

function setActNowBtn() {
  const b = $("actNowToggle");
  b.setAttribute("aria-pressed", String(state.actNowOnly));
}

function switchView(view) {
  state.view = view;
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  $("viewNav").querySelectorAll(".viewtab").forEach((t) => {
    const on = t.dataset.view === view;
    t.classList.toggle("is-active", on);
    on ? t.setAttribute("aria-current", "page") : t.removeAttribute("aria-current");
  });
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("is-active", v.dataset.view === view));
  // Overview is the whole-portfolio snapshot — filters don't apply there, so
  // hide the rail to remove the "controls that do nothing" confusion. Every
  // other view is filter-driven, so the rail is shown.
  document.querySelector(".layout").classList.toggle("rail-hidden", view === "overview");
  if (view !== "flows" && state.netSim) { state.netSim.stop(); state.netSim = null; }
  renderView();
}

/* ---------------- render orchestration ---------------- */
function renderAll() { renderKpis(); renderActiveFilters(); renderView(); }

function renderView() {
  if (state.view === "overview") renderOverview();
  else if (state.view === "action") renderAction();
  else if (state.view === "flows") renderFlows();
  else renderExplore();
}

function renderKpis() {
  // Overview is the whole-portfolio strategic map; Action/Explore are the
  // filtered working set — KPIs follow suit so the numbers never contradict
  // the view the user is looking at.
  const overview = state.view === "overview";
  const f = overview ? state.assets : state.filtered;
  $("kpiAssets").textContent = f.length;
  $("kpiAssetsFoot").textContent = overview ? "whole portfolio" : `of ${state.assets.length} total`;
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
   Overview is the stable strategic map: it always reflects the WHOLE
   portfolio and never collapses under rail filters. Clicking any element
   drills through to Explore with that filter applied. */
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

function renderGapMatrix() {
  const grid = {};
  let max = 1;
  state.assets.forEach((a) => {
    if (!DOMAINS.includes(a.domain_norm) || !GEOS.includes(a.geo_norm)) return;
    const k = `${a.domain_norm}|||${a.geo_norm}`;
    grid[k] = (grid[k] || 0) + 1;
    max = Math.max(max, grid[k]);
  });

  const head = `<div class="gap-row" style="--cols:${GEOS.length}">
      <div class="gap-corner"></div>
      ${GEOS.map((g) => `<div class="gap-colhead">${esc(g)}</div>`).join("")}</div>`;
  const rows = DOMAINS.map((d) => {
    const cells = GEOS.map((g) => {
      const k = `${d}|||${g}`;
      const v = grid[k] || 0;
      const t = v / max;
      const bg = v === 0 ? "" : `background:rgba(25,85,166,${0.12 + t * 0.78});color:${t > 0.5 ? "#fff" : COL.green}`;
      const cls = `gap-cell${v === 0 ? " is-zero" : ""}`;
      return `<div class="${cls}" style="${bg}" data-d="${esc(d)}" data-g="${esc(g)}" title="${esc(d)} × ${esc(g)}: ${v} — click to open in Explore">${v || ""}</div>`;
    }).join("");
    return `<div class="gap-row" style="--cols:${GEOS.length}"><div class="gap-rowhead">${esc(d)}</div>${cells}</div>`;
  }).join("");

  $("gapMatrix").innerHTML = head + rows;
  $("gapLegend").innerHTML =
    `<span><span class="dot" style="background:rgba(25,85,166,.25)"></span>few</span>
     <span><span class="dot" style="background:${COL.blue}"></span>many</span>
     <span><span class="dot" style="background:#FBEDEA;border:1px dashed #E4B6AB"></span>gap</span>`;

  $("gapMatrix").querySelectorAll(".gap-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      if (cell.classList.contains("is-zero")) return;   // nothing to open
      drillTo([["domain_norm", cell.dataset.d], ["geo_norm", cell.dataset.g]]);
    });
  });
}

function renderInsights() {
  const f = state.assets;          // always whole portfolio
  const out = [];
  const grid = {};
  f.forEach((a) => { const k = `${a.domain_norm} in ${a.geo_norm}`; grid[k] = (grid[k] || 0) + 1; });
  const top = Object.entries(grid).sort((a, b) => b[1] - a[1])[0];
  if (top) out.push(`<div class="insight insight-strong"><span class="ic">💪</span><p>Deepest coverage: <b>${esc(top[0])}</b> with <b>${top[1]}</b> assets.</p></div>`);

  const empties = DOMAINS.filter((d) => !f.some((a) => a.domain_norm === d));
  if (empties.length) out.push(`<div class="insight insight-gap"><span class="ic">⚠️</span><p>Thematic gap — no assets at all in <b>${empties.map(esc).join(", ")}</b>.</p></div>`);

  const thinGeo = GEOS.map((g) => [g, f.filter((a) => a.geo_norm === g).length]).sort((a, b) => a[1] - b[1])[0];
  if (thinGeo) out.push(`<div class="insight insight-gap"><span class="ic">🌍</span><p>Thinnest geography: <b>${esc(thinGeo[0])}</b> (${thinGeo[1]} assets).</p></div>`);

  const dc = {};
  f.forEach((a) => (dc[a.domain_norm] ||= new Set()).add(a.centre));
  const solo = Object.entries(dc).filter(([d, s]) => s.size === 1 && d !== "Not specified");
  if (solo.length) out.push(`<div class="insight insight-risk"><span class="ic">🎯</span><p>Concentration risk: <b>${solo.length}</b> domain(s) rest on a single centre — e.g. ${esc(solo[0][0])} (${esc([...solo[0][1]][0])}).</p></div>`);

  const open = f.filter((a) => a.access_norm === "Open").length;
  out.push(`<div class="insight insight-strong"><span class="ic">🔓</span><p><b>${Math.round(open / f.length * 100)}%</b> open access — the rest need an access conversation before federation.</p></div>`);

  $("insightList").innerHTML = out.join("");
}

const scoreColor = (s) => s >= 78 ? COL.open : s >= 65 ? COL.gold : COL.restricted;

// Palette for nominator segments (identity is incidental — no legend; the
// nominator + count is revealed on hover).
const SEG_COLORS = ["#1955A6", "#1F8A70", "#E0A11B", "#63A9FE", "#C2691C",
  "#17F1BD", "#7D8CC4", "#8B5CF6", "#2E7D52", "#EC4899", "#5C6B73", "#AE6C7A"];

function renderCentreStrength() {
  const map = {};
  state.assets.forEach((a) => {
    (map[a.centre] ||= { n: 0, sum: 0, k: 0, hub: a.hub_funded, noms: {} });
    const m = map[a.centre];
    m.n++;
    if (a.priority_score != null) { m.sum += a.priority_score; m.k++; }
    const nm = (a.nominator || "Unattributed").split("\n")[0].trim() || "Unattributed";
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
    return `
    <div class="strength-row" data-centre="${esc(r.c)}">
      <div class="strength-name">${r.hub ? '<span class="hub-dot" title="Hub-funded"></span>' : ""}${esc(r.c)}</div>
      <div class="strength-track"><div class="strength-fill" style="width:${Math.max(6, r.n / max * 100)}%">${segs}</div></div>
      <div class="strength-count">${r.n}</div>
      <div class="strength-badge" style="background:${scoreColor(r.mean)}" title="Mean priority score">${r.mean}</div>
    </div>`;
  }).join("");

  $("centreStrength").querySelectorAll(".strength-row").forEach((row) =>
    row.addEventListener("click", () => drillTo([["centre", row.dataset.centre]])));
}

function renderDomainChart() {
  const entries = Object.entries(countBy(state.assets, "domain_norm")).sort((a, b) => b[1] - a[1]);
  barChart("domainChart", entries, COL.blue, (label) => drillTo([["domain_norm", label]]));
}

function renderOwnerChart() {
  // Stacked horizontal: asset type x access status (whole portfolio).
  const types = orderValues("type_norm", [...new Set(state.assets.map((a) => a.type_norm))]);
  const accesses = ["Open", "Restricted", "Unknown"];
  const datasets = accesses.map((acc) => ({
    label: acc,
    data: types.map((t) => state.assets.filter((a) => a.type_norm === t && a.access_norm === acc).length),
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

function renderQuadrant() {
  $("quadLegend").innerHTML = Object.entries(ACCESS_COL).map(([k, v]) =>
    `<span><span class="dot" style="background:${v}"></span>${k}</span>`).join("");
  if (state.quadMode === "beeswarm") return renderBeeswarm();

  $("priPlotSub").textContent =
    "Technical readiness × reuse potential. Bubble size = decision relevance · colour = access. Click a point for detail.";
  const pts = { Open: [], Restricted: [], Unknown: [] };
  state.filtered.forEach((a) => {
    const x = a.sc.technical_readiness, y = a.sc.reuse_potential;
    if (x == null || y == null) return;
    const r = 4 + (a.sc.decision_relevance ?? 0.5) * 11;
    (pts[a.access_norm] || pts.Unknown).push({
      // deterministic spread (no Math.random so points don't jump on re-render)
      x: x + jitter(a.label, 1) * 0.06,
      y: y + jitter(a.label, 2) * 0.06,
      r, asset: a,
    });
  });
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
        x: { min: 0.15, max: 1.05, title: { display: true, text: "Technical readiness →", color: "#6B7B88", font: { size: 11 } }, grid: { color: "#EEF2F7" }, ticks: { font: { size: 10 } } },
        y: { min: 0.15, max: 1.05, title: { display: true, text: "Reuse potential →", color: "#6B7B88", font: { size: 11 } }, grid: { color: "#EEF2F7" }, ticks: { font: { size: 10 } } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.raw.asset.name} · score ${c.raw.asset.priority_score ?? "—"} · ${c.raw.asset.access_norm}` } },
      },
    },
  });
}

/* Beeswarm: x = priority score, points dodged into lanes by access so dense
   clusters never overlap — every asset is individually hoverable/clickable.
   Solves the bubble-pileup problem in the quadrant view. */
const SWARM_LANES = ["Open", "Restricted", "Unknown"];
function renderBeeswarm() {
  $("priPlotSub").textContent =
    "Every asset as one dot · x = priority score (sort aid) · lane = access. Dots are spread so none overlap — click any for detail.";
  const laneBase = { Open: 3, Restricted: 2, Unknown: 1 };
  const datasets = SWARM_LANES.map((acc) => {
    const items = state.filtered
      .filter((a) => a.access_norm === acc && a.priority_score != null)
      .sort((p, q) => p.priority_score - q.priority_score);
    // bin by score, stack alternately above/below the lane centre
    const binW = 3, counts = {}, data = [];
    items.forEach((a) => {
      const b = Math.round(a.priority_score / binW);
      const k = (counts[b] = (counts[b] || 0) + 1) - 1;  // 0-based within bin
      const off = Math.ceil(k / 2) * 0.16 * (k % 2 ? 1 : -1);  // 0, +.16, -.16, +.32…
      data.push({ x: a.priority_score, y: laneBase[acc] + off, asset: a });
    });
    return { label: acc, data, backgroundColor: hexA(ACCESS_COL[acc], 0.7), borderColor: "#fff", borderWidth: 1,
      hoverBackgroundColor: ACCESS_COL[acc], hoverBorderColor: COL.green, hoverBorderWidth: 2, pointRadius: 6, pointHoverRadius: 8 };
  }).filter((d) => d.data.length);
  replaceChart("quadrant", {
    type: "scatter",
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (_, els) => { if (els.length) { const d = state.charts.quadrant.data.datasets[els[0].datasetIndex].data[els[0].index]; openDrawer(d.asset); } },
      scales: {
        x: { min: 0, max: 100, title: { display: true, text: "Priority score (sort aid) →", color: "#6B7B88", font: { size: 11 } }, grid: { color: "#EEF2F7" }, ticks: { font: { size: 10 } } },
        y: { min: 0.3, max: 3.7, grid: { display: false },
          ticks: { stepSize: 1, font: { size: 11 }, color: COL.green,
            callback: (v) => ({ 1: "Unknown", 2: "Restricted", 3: "Open" }[v] || "") } },
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
    return `<div class="pbar" data-value="${esc(p.key)}">
      <div class="pbar-top"><span>${esc(p.key)}</span><b>${v} · ${Math.round(v / total * 100)}%</b></div>
      <div class="pbar-track"><div class="pbar-fill" style="width:${v / total * 100}%;background:${p.col}"></div></div>
    </div>`;
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
    return `<article class="qcard" data-label="${esc(a.label)}">
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
  host.querySelectorAll(".qcard").forEach((card) =>
    card.addEventListener("click", () => openDrawer(byLabel(card.dataset.label))));
}

/* ================= FLOWS =================
   Two relational views the static report can't show, both driven by the
   current filter:
     · Sankey  — how each centre's assets flow Centre → Domain → Pathway.
     · Network — assets linked when they share ≥2 climate input variables;
                 multi-colour clusters = several centres building on the same
                 inputs → a consolidation / shared-service opportunity. */
function renderFlows() {
  if (state.netSim) { state.netSim.stop(); state.netSim = null; }
  const host = $("flowCanvas");
  host.innerHTML = "";
  const empty = !state.filtered.length;
  $("flowEmpty").hidden = !empty;
  host.hidden = empty;
  if (empty) { $("flowLegend").innerHTML = ""; return; }
  if (typeof d3 === "undefined") { host.innerHTML = `<div class="empty">Flow library failed to load (offline?).</div>`; return; }
  if (state.flowMode === "network") renderNetwork(host);
  else renderSankey(host);
}

function flowDims(host) {
  const w = Math.max(320, host.clientWidth || 900);
  return { w, h: state.flowMode === "network" ? 560 : 520 };
}

/* ---- Sankey: Centre → Domain → Pathway ---- */
function renderSankey(host) {
  $("flowTitle").textContent = "Portfolio flows — centre → domain → integration pathway";
  $("flowSub").textContent = "How each centre's assets flow into themes and what happens to them next. Reflects the current filter. Hover a band for counts; click a node to filter.";
  const { w, h } = flowDims(host);
  const nodes = [], index = new Map();
  const nodeKey = (kind, name) => `${kind}:${name}`;
  function node(kind, name, field) {
    const k = nodeKey(kind, name);
    if (!index.has(k)) { index.set(k, nodes.length); nodes.push({ name, kind, field }); }
    return index.get(k);
  }
  const linkMap = new Map();
  const addLink = (s, t, key) => {
    let l = linkMap.get(key);
    if (!l) { l = { source: s, target: t, value: 0 }; linkMap.set(key, l); }
    l.value++;
  };
  state.filtered.forEach((a) => {
    const c = node("centre", a.centre, "centre");
    const d = node("domain", a.domain_norm, "domain_norm");
    const p = node("pathway", a.integration_hint, "integration_hint");
    addLink(c, d, `c${c}-d${d}`);
    addLink(d, p, `d${d}-p${p}`);
  });
  const links = [...linkMap.values()];

  const sankey = d3.sankey()
    .nodeWidth(15).nodePadding(11)
    .extent([[6, 8], [w - 6, h - 8]]);
  const graph = sankey({ nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) });

  const svg = d3.select(host).append("svg").attr("width", w).attr("height", h).attr("class", "flow-svg");
  const pathColor = (n) => PATHWAY.find((p) => p.key === n.name)?.col || COL.unknown;
  const nodeColor = (n) => n.kind === "centre" ? centreColor(n.name)
    : n.kind === "pathway" ? pathColor(n) : COL.blue;
  // Left half (centre→domain) carries the centre colour; right half
  // (domain→pathway) carries the PATHWAY colour so federate/negotiate/etc.
  // read as meaning, not a wall of identical blue.
  const linkColor = (l) => l.source.kind === "centre" ? centreColor(l.source.name) : pathColor(l.target);
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

  $("flowLegend").innerHTML =
    `<span><span class="dot" style="background:${COL.blue}"></span>domain</span>` +
    `<span class="flow-hint">centre = own colour · ribbon to pathway colour-coded:</span>` +
    PATHWAY.map((p) => `<span><span class="dot" style="background:${p.col}"></span>${esc(p.key)}</span>`).join("");
}

/* ---- Network: centre ↔ domain bipartite ----
   Centres and domains as nodes; an edge means a centre has assets in that
   domain (width = how many). A domain pulled by several centres is a hub
   coordination target; a domain hanging off one centre is concentration
   risk. A relational angle the report's static matrix can't give. */
function renderNetwork(host) {
  $("flowTitle").textContent = "Collaboration network — which centres cover which domains";
  $("flowSub").textContent = "Centres (coloured) and domains (dark) linked when a centre holds assets in that domain; line thickness = how many. Domains pulled by several centres are coordination targets; domains hanging off one centre are concentration risk. Click any node to filter.";
  const { w, h } = flowDims(host);

  const edgeMap = new Map();   // "centre|||domain" -> count
  const cTot = {}, dTot = {}, dCentres = {};
  state.filtered.forEach((a) => {
    const c = a.centre, dm = a.domain_norm;
    const k = `${c}|||${dm}`;
    edgeMap.set(k, (edgeMap.get(k) || 0) + 1);
    cTot[c] = (cTot[c] || 0) + 1;
    dTot[dm] = (dTot[dm] || 0) + 1;
    (dCentres[dm] ||= new Set()).add(c);
  });
  const nodes = [], nIdx = new Map();
  const addNode = (kind, name, field) => {
    const id = `${kind}:${name}`;
    if (!nIdx.has(id)) {
      const tot = (kind === "centre" ? cTot[name] : dTot[name]) || 0;
      nIdx.set(id, nodes.length);
      nodes.push({ id, kind, name, field, tot, r: 7 + Math.sqrt(tot) * 3.2 });
    }
    return nIdx.get(id);
  };
  const links = [...edgeMap.entries()].map(([k, v]) => {
    const [c, dm] = k.split("|||");
    return { source: addNode("centre", c, "centre"), target: addNode("domain", dm, "domain_norm"), v };
  });

  const svg = d3.select(host).append("svg").attr("width", w).attr("height", h).attr("class", "flow-svg");
  const link = svg.append("g").attr("stroke", "#B8C4D0").selectAll("line")
    .data(links).join("line")
    .attr("stroke-width", (d) => Math.max(1, Math.min(6, d.v)))
    .attr("stroke-opacity", 0.45)
    .on("mousemove", (e, d) => showTip(`<b>${esc(d.source.name)}</b> → <b>${esc(d.target.name)}</b><br>${d.v} asset${d.v > 1 ? "s" : ""}`, e))
    .on("mouseleave", hideTip);

  const g = svg.append("g").selectAll("g").data(nodes).join("g").style("cursor", "pointer")
    .on("mousemove", (e, d) => showTip(
      d.kind === "centre"
        ? `<b>${esc(d.name)}</b><br>${d.tot} asset${d.tot > 1 ? "s" : ""}`
        : `<b>${esc(d.name)}</b><br>${d.tot} asset${d.tot > 1 ? "s" : ""} · ${dCentres[d.name]?.size || 0} centre${(dCentres[d.name]?.size || 0) > 1 ? "s" : ""}`, e))
    .on("mouseleave", hideTip)
    .on("click", (e, d) => { hideTip(); drillTo([[d.field, d.name]]); });
  g.append("circle")
    .attr("r", (d) => d.r)
    .attr("fill", (d) => d.kind === "centre" ? centreColor(d.name) : COL.green)
    .attr("stroke", "#fff").attr("stroke-width", 1.5);
  g.append("text")
    .attr("class", "flow-nodelabel")
    .attr("text-anchor", "middle")
    .attr("dy", (d) => d.r + 12)
    .text((d) => d.kind === "domain" || d.tot >= 8 ? d.name : "");

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

  const multi = Object.values(dCentres).filter((s) => s.size >= 3).length;
  const solo = Object.values(dCentres).filter((s) => s.size === 1).length;
  $("flowLegend").innerHTML =
    `<span><span class="dot" style="background:${COL.blue}"></span>centre</span>` +
    `<span><span class="dot" style="background:${COL.green}"></span>domain</span>` +
    `<span class="flow-stat">${multi} domain${multi === 1 ? "" : "s"} span ≥3 centres</span>` +
    `<span class="flow-stat">${solo} on a single centre</span>` +
    `<span class="flow-hint">node size = assets · drag to explore</span>`;
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
    <tr data-label="${esc(a.label)}">
      <td class="td-name"><strong>${esc(a.name)}</strong><small>${a.hub_funded ? "Hub-funded" : "Non-hub"}${a.foundational ? " · foundational" : ""}</small></td>
      <td>${esc(a.centre)}</td>
      <td>${esc(a.domain_norm)}</td>
      <td>${esc(a.geo_norm)}</td>
      <td>${esc(a.type_norm)}</td>
      <td class="num">${a.priority_score ?? "—"}</td>
      <td><span class="pill ${accClass(a)}">${esc(a.access_norm)}</span></td>
      <td>${esc(a.integration_hint)}</td>
    </tr>`).join("");
  tb.querySelectorAll("tr[data-label]").forEach((tr) =>
    tr.addEventListener("click", () => openDrawer(byLabel(tr.dataset.label))));
}

/* ================= DRAWER ================= */
function openDrawer(a) {
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
      ${row("Nominator", a.nominator)}${row("Organisation", a.asset_organization)}</div>
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
}
function closeDrawer() {
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
