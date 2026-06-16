# CDH Asset Mapping

Reproducible pipeline for CGIAR Climate Data Hub system-wide asset mapping exercise.

## Structure

```
cdh-asset-mapping/
├── data/
│   ├── submissions/         # Raw Excel files from each centre (one per centre)
│   ├── merge_log.json       # Applied and recommended asset consolidations
│   └── normalized/
│       └── assets.json      # Generated: normalised asset inventory
├── src/
│   ├── ingest.py            # Excel → assets.json
│   ├── figures.py           # assets.json → PNG figures
│   ├── report_common.py     # Shared stats + narrative helpers
│   └── report.py            # Optional markdown export
├── report.qmd               # Primary report source → HTML/PDF/Word
├── dashboard/
│   ├── app.R                # Interactive Shiny dashboard
│   └── README.md
├── docs/
│   ├── index.html           # Static GitHub Pages dashboard
│   ├── dashboard.js         # Client-side interactions
│   ├── styles.css           # Dashboard styling
│   └── data/assets.json     # Exported dashboard data
├── outputs/
│   ├── figures/             # Generated figures (fig1–fig5)
│   └── CDH_Asset_Mapping_Report.md  # Optional markdown export
└── requirements.txt
```

## Setup

```bash
pip install -r requirements.txt
```

## Running the pipeline

```bash
.venv/bin/python src/ingest.py    # reads submissions/, writes data/normalized/assets.json
.venv/bin/python src/figures.py   # writes outputs/figures/*.png
env QUARTO_PYTHON=.venv/bin/python quarto render report.qmd --to html   # primary review output
.venv/bin/python src/report.py    # optional markdown export
python src/export_dashboard_data.py   # refresh static dashboard data
Rscript -e 'shiny::runApp("dashboard")'   # interactive dashboard
```

Or all at once:

```bash
.venv/bin/python src/ingest.py
.venv/bin/python src/figures.py
env QUARTO_PYTHON=.venv/bin/python quarto render report.qmd --to html
```

For Quarto output:

```bash
env QUARTO_PYTHON=.venv/bin/python quarto render report.qmd --to html
env QUARTO_PYTHON=.venv/bin/python quarto render report.qmd --to docx
env QUARTO_PYTHON=.venv/bin/python quarto render report.qmd --to pdf
```

For GitHub Pages dashboard:

```bash
python src/export_dashboard_data.py
# Publish /docs as GitHub Pages source
```

## Initialising the GitHub repo

This folder is on OneDrive which doesn't support git lock files. Run these commands
from Terminal (not from a cloud-synced shell):

```bash
cd ~/Library/CloudStorage/OneDrive-CGIAR/Climate_data_hub/Claude/cdh-asset-mapping

# If .git already exists from a partial init, remove it first:
rm -rf .git

git init
git branch -m main
git config user.email "p.steward@cgiar.org"
git config user.name "Pete Steward"
git add .
git commit -m "Initial commit: full reproducible asset mapping pipeline"

# Connect to GitHub (create empty repo at github.com/CGIAR-Climate-Data-Hub/cdh-asset-mapping first):
git remote add origin https://github.com/CGIAR-Climate-Data-Hub/cdh-asset-mapping.git
git push -u origin main
```

## Adding a new centre submission

1. Drop the new Excel file into `data/submissions/<Centre>.xlsx`
2. Add the centre to `CENTRE_FILES` in `src/ingest.py`
3. Mark as `HUB_FUNDED` if applicable
4. Re-run the pipeline
5. Commit

## Notes

- `report.qmd` is primary report source. HTML output supports foldable code blocks for review.
- Set `DASHBOARD_URL` near top of `report.qmd` when official interactive data endpoint is available.
- `dashboard/app.R` is local interactive explorer over `data/normalized/assets.json`.
- `docs/` is GitHub Pages-ready static dashboard with client-side filtering and plotting.
- `src/report.py` is secondary export path when plain markdown is needed.
- All statistics in report outputs are computed from `assets.json` — there are no hardcoded numbers.
- The merge log (`data/merge_log.json`) records all consolidations. Update it when new merges are agreed.
- 3 assets have no spatial coverage in the submission (IITA Sims, IRRI Rice-GEM, IRRI Rice Mitigation Hotspots) — these are excluded from geographic figures.
- ICARDA submission is pending; totals will update when it arrives.
