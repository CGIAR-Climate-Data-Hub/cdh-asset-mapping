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
];

const state = {
  assets: [],
  filtered: [],
  view: "overview",
  filters: {},               // field -> Set of selected values
  search: "",
  actNowOnly: false,
  queueTab: "now",
  tableSort: "priority_score",
  tableDir: "desc",
  selectedCell: null,        // "domain|||geo"
  charts: {},
};
FILTER_DIMS.forEach((d) => (state.filters[d.field] = new Set()));

const $ = (id) => document.getElementById(id);

/* ---------------- init ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  const res = await fetch(DATA_URL);
  state.assets = (await res.json()).map(deriveAsset);
  const hash = (location.hash || "").replace("#", "");
  if (["overview", "action", "explore"].includes(hash)) state.view = hash;
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
    const open = field === "domain_norm";
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
  renderView();
}

/* ---------------- render orchestration ---------------- */
function renderAll() { renderKpis(); renderActiveFilters(); renderView(); }

function renderView() {
  if (state.view === "overview") renderOverview();
  else if (state.view === "action") renderAction();
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

function renderCentreStrength() {
  const map = {};
  state.assets.forEach((a) => {
    (map[a.centre] ||= { n: 0, sum: 0, k: 0, hub: a.hub_funded });
    map[a.centre].n++;
    if (a.priority_score != null) { map[a.centre].sum += a.priority_score; map[a.centre].k++; }
  });
  const rows = Object.entries(map).map(([c, m]) => ({ c, n: m.n, mean: m.k ? Math.round(m.sum / m.k) : 0, hub: m.hub }))
    .sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...rows.map((r) => r.n));

  $("centreStrength").innerHTML = rows.map((r) => `
    <div class="strength-row" data-centre="${esc(r.c)}" title="Open ${esc(r.c)} in Explore">
      <div class="strength-name">${r.hub ? '<span class="hub-dot" title="Hub-funded"></span>' : ""}${esc(r.c)}</div>
      <div class="strength-track"><div class="strength-fill" style="width:${Math.max(6, r.n / max * 100)}%"><span>${r.n}</span></div></div>
      <div class="strength-badge" style="background:${scoreColor(r.mean)}" title="Mean priority score">${r.mean}</div>
    </div>`).join("");

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
  const pts = { Open: [], Restricted: [], Unknown: [] };
  state.filtered.forEach((a) => {
    const x = a.sc.technical_readiness, y = a.sc.reuse_potential;
    if (x == null || y == null) return;
    const r = 4 + (a.sc.decision_relevance ?? 0.5) * 11;
    (pts[a.access_norm] || pts.Unknown).push({
      x: x + (Math.random() - 0.5) * 0.05,
      y: y + (Math.random() - 0.5) * 0.05,
      r, asset: a,
    });
  });
  const datasets = Object.entries(pts).filter(([, v]) => v.length).map(([acc, data]) => ({
    label: acc, data, backgroundColor: hexA(ACCESS_COL[acc], 0.55), borderColor: "#fff", borderWidth: 1,
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
  $("quadLegend").innerHTML = Object.entries(ACCESS_COL).map(([k, v]) =>
    `<span><span class="dot" style="background:${v}"></span>${k}</span>`).join("");
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
  $("qNowCount").textContent = state.filtered.filter(isActNow).length;
  $("qNextCount").textContent = state.filtered.filter(isNextCycle).length;
}

function renderQueue() {
  const now = state.queueTab === "now";
  const list = state.filtered.filter(now ? isActNow : isNextCycle)
    .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));
  const host = $("actionQueue");
  if (!list.length) { host.innerHTML = `<div class="empty">No assets match. ${now ? "Loosen filters or check Next cycle." : ""}</div>`; return; }

  host.innerHTML = list.map((a) => {
    const why = a.justification || a.primary_use_case || a.short_description || "";
    const blocker = now ? "" : (a.access_norm === "Restricted"
      ? `<div class="qcard-blocker">⛔ Restricted access</div>`
      : `<div class="qcard-blocker">⛔ Readiness below High</div>`);
    return `<article class="qcard" data-label="${esc(a.label)}">
      <div class="qscore">${a.priority_score ?? "—"}<small>score</small></div>
      <div>
        <h4>${esc(a.name)}${a.is_top3_in_centre ? ' <span class="pill pill-top">top-3</span>' : ""}</h4>
        <div class="qcard-meta">${esc(a.centre)} · ${esc(a.domain_norm)} · ${esc(a.geo_norm)}</div>
        <div class="qcard-why">${esc(why)}</div>
        <div class="qcard-pills">
          <span class="pill ${accClass(a)}">${esc(a.access_norm)}</span>
          <span class="pill">${esc(a.integration_hint)}</span>
        </div>${blocker}
      </div></article>`;
  }).join("");
  host.querySelectorAll(".qcard").forEach((card) =>
    card.addEventListener("click", () => openDrawer(byLabel(card.dataset.label))));
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
    ${a.priority_score != null ? `<div class="drawer-score">${a.priority_score}<small>/100 priority</small></div>` : ""}
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
      ${row("Spatial coverage", a.spatial_coverage)}${row("Spatial resolution", a.spatial_resolution)}
      ${row("Temporal type", a.temporal_type)}${row("File format", a.file_format)}
      ${row("Year last updated", a.year_last_updated)}${row("Actively maintained", yn(a.actively_maintained))}</div>
    <div class="drawer-group"><h5>Context</h5>
      ${row("Nominator", a.nominator)}${row("Organisation", a.asset_organization)}${row("Primary use case", a.primary_use_case)}</div>
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
