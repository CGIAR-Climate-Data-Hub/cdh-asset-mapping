"""Headless regression checks for the docs/ dashboard.

Covers the fixes from the July 2026 review waves (issues #7-#11, #14-#16),
the clickable act-now KPI card, and the coverage-map axis selectors.
Counts are read from docs/data/assets.json, never hardcoded.

Run:  .venv/bin/python tests/verify_dashboard.py
Requires: playwright installed in the venv + chromium downloaded
(.venv/bin/playwright install chromium).
"""
import json
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
PORT = 8940

ASSETS = json.load(open(DOCS / "data" / "assets.json"))
TOTAL = len(ASSETS)
HAZARD = sum(1 for a in ASSETS if a.get("domain_norm") == "Hazard")

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))


def active_view(page):
    return page.get_attribute(".view.is-active", "data-view")


def cell_sum(page):
    return page.evaluate(
        "[...document.querySelectorAll('.gap-cell')].reduce((s,c)=>s+(+c.textContent||0),0)")


def main():
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "-d", str(DOCS)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            run_checks(browser)
            browser.close()
    finally:
        server.terminate()

    fails = [r for r in results if not r[1]]
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    print(f"\n{len(results) - len(fails)}/{len(results)} passed")
    return 1 if fails else 0


def run_checks(browser):
    page = browser.new_page()
    page.goto(f"http://localhost:{PORT}/index.html")
    page.wait_for_selector(".fchip")

    kpi = lambda: page.text_content("#kpiAssets").strip()

    # --- coverage map totals + filter consistency (#8, #9, #10) -------------
    check("map sums to headline (whole portfolio)",
          kpi() == str(TOTAL) and cell_sum(page) == TOTAL,
          f"kpi={kpi()} sum={cell_sum(page)}")

    page.click('.viewtab[data-view="explore"]')
    page.click('.fchip[data-field="domain_norm"][data-value="Hazard"]')
    page.wait_for_timeout(200)
    check("Hazard filter count", kpi() == str(HAZARD), kpi())
    page.click('.viewtab[data-view="overview"]')
    page.wait_for_timeout(200)
    check("KPI matches map under filter", int(kpi()) == cell_sum(page),
          f"kpi={kpi()} sum={cell_sum(page)}")
    check("rail + reset visible on Overview",
          page.is_visible("#rail") and page.is_visible("#resetFilters"))
    page.click("#resetFilters")
    page.wait_for_timeout(200)
    check("reset restores whole portfolio", kpi() == str(TOTAL), kpi())

    # --- priority plot omission note (#11) -----------------------------------
    page.click('.viewtab[data-view="action"]')
    page.wait_for_timeout(300)
    sub = page.text_content("#priPlotSub") or ""
    check("omission note present",
          "assets drawn" in sub or "assets in view drawn" in sub, sub[-80:])

    # --- history: back steps views, closes drawer (#7) -----------------------
    page.click('.viewtab[data-view="explore"]')
    page.wait_for_selector("#assetTable tbody tr[data-label]")
    page.click("#assetTable tbody tr[data-label]")
    page.wait_for_timeout(200)
    page.go_back()
    page.wait_for_timeout(300)
    check("back closes drawer in place",
          "index.html" in page.url
          and not page.eval_on_selector("#drawer", "e => e.classList.contains('is-open')")
          and active_view(page) == "explore", page.url)

    # --- a11y basics (#16) ----------------------------------------------------
    page.click('.viewtab[data-view="overview"]')
    page.wait_for_timeout(200)
    check("map cells are labelled buttons", page.evaluate(
        """() => [...document.querySelectorAll('.gap-cell:not(.is-zero)')]
              .every(c => c.tagName === 'BUTTON' && c.getAttribute('aria-label'))"""))
    check("centre bars are labelled buttons", page.evaluate(
        """() => [...document.querySelectorAll('.strength-row')]
              .every(r => r.tagName === 'BUTTON' && r.getAttribute('aria-label'))"""))

    # --- act-now KPI card ------------------------------------------------------
    expected = page.text_content("#kpiActNow").strip()
    page.click("#kpiActNowCard")
    page.wait_for_timeout(300)
    rows = len(page.query_selector_all("#assetTable tbody tr[data-label]"))
    check("act-now card opens Explore with counted assets",
          active_view(page) == "explore" and rows == int(expected),
          f"expected={expected} rows={rows}")
    page.click("#resetFilters")
    page.wait_for_timeout(200)

    # --- coverage-map axis selectors -------------------------------------------
    page.click('.viewtab[data-view="overview"]')
    page.wait_for_timeout(200)
    page.select_option("#pc_gapC", "centre")
    page.wait_for_timeout(200)
    heads = page.eval_on_selector_all(".gap-colhead", "els => els.map(e => e.textContent)")
    check("centre columns render and still sum",
          "IFPRI" in heads and cell_sum(page) == TOTAL,
          f"sum={cell_sum(page)}")

    # --- phone width (#15) ------------------------------------------------------
    phone = browser.new_page(viewport={"width": 390, "height": 844})
    phone.goto(f"http://localhost:{PORT}/index.html")
    phone.wait_for_selector(".fchip")
    scroll_w = phone.evaluate("document.documentElement.scrollWidth")
    check("no horizontal overflow at 390px", scroll_w <= 390, f"scrollWidth={scroll_w}")
    phone.close()

    # --- typo fix stays fixed (#14) ----------------------------------------------
    page.fill("#searchInput", "Irrigater")
    page.wait_for_timeout(200)
    check("'Irrigater' typo gone", kpi() == "0", kpi())

    page.close()


if __name__ == "__main__":
    sys.exit(main())
