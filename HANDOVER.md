# Handover

## Current state

Repo now has two dashboard paths:

- `dashboard/app.R`
  Local Shiny prototype. Useful for comparison only. Not GitHub Pages deploy target.
- `docs/`
  Static GitHub Pages-ready dashboard. This is current primary dashboard path.

Report paths:

- `report.qmd`
  Primary source for rendered report outputs.
- `report.html`
  Rendered HTML report.
- `src/report.py`
  Secondary Markdown export path.

## Static dashboard

Entry point:

- `docs/index.html`

Core files:

- `docs/dashboard.js`
- `docs/styles.css`
- `docs/data/assets.json`

Data refresh:

```bash
python src/export_dashboard_data.py
```

Local preview:

```bash
python -m http.server 8803 --directory docs
```

Then open:

- `http://127.0.0.1:8803`

## Dashboard intent

Current design is refocused around four user questions:

1. Who submitted what?
2. What types of data are most represented?
3. How can report figures be explored interactively?
4. What should Hub team prioritize for ingestion?

Implemented sections:

- quick filters
- shared control deck
- submissions / centre summary
- representation charts
- figure lab
- heatmap
- prioritization lens
- asset browser
- full table

## Known issues / next work

Main open UX issue:

- control system still needs simplification and stronger coherence
- likely next step is single sticky control rail or much tighter shared toolbar

Likely next functional improvements:

- richer chart tooltips with example assets
- click-to-filter behavior across more components
- better centre summary cards
- stronger prioritization scoring logic with explicit rationale
- optional map/geography view if needed

## Report workflow

Render report:

```bash
env QUARTO_PYTHON=.venv/bin/python quarto render report.qmd --to html
env QUARTO_PYTHON=.venv/bin/python quarto render report.qmd --to docx
```

PDF still requires TeX install.

## GitHub Pages

Publish `docs/` as Pages source.

Dashboard path on Pages will be:

- `/docs/index.html` in repo
- site root equivalent once Pages is configured

## Notes

- `data/normalized/assets.json` is generated. Do not hand-edit.
- `outputs/` remains generated output area.
- Current branch: `main`
- Remote: `origin`
