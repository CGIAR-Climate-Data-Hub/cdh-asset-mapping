# CDH Asset Explorer

Interactive Shiny dashboard for subsetting, plotting, comparing, and inspecting CGIAR Climate Data Hub asset inventory.

## Run

```r
shiny::runApp("dashboard")
```

Or from shell:

```bash
Rscript -e 'shiny::runApp("dashboard", launch.browser = TRUE)'
```

## What it does

- Filter assets by centre, domain, type bucket, geography, hub-funded status, rank, and text search
- Plot assets by centre, domain, type, geography, or other dimensions
- Compare dimensions with stacked counts or within-group shares
- Explore filtered asset table and download subset as CSV or JSON
- Inspect one asset in detail, including readiness, role, scope, and description
