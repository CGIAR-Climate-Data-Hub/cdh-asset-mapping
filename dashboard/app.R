library(shiny)
library(bslib)
library(DT)
library(dplyr)
library(ggplot2)
library(jsonlite)
library(scales)
library(stringr)
library(tidyr)

`%||%` <- function(x, y) {
  if (is.null(x) || length(x) == 0) y else x
}

current_dir <- normalizePath(getwd(), mustWork = FALSE)
root_dir <- if (basename(current_dir) == "dashboard") {
  normalizePath(file.path(current_dir, ".."), mustWork = FALSE)
} else {
  current_dir
}
assets_path <- file.path(root_dir, "data", "normalized", "assets.json")

load_assets <- function(path) {
  assets <- fromJSON(paste(readLines(path, warn = FALSE), collapse = "\n"), simplifyDataFrame = TRUE)

  assets |>
    as_tibble() |>
    mutate(
      across(where(is.character), ~ na_if(str_squish(.x), "")),
      hub_funded = if_else(isTRUE(hub_funded) | hub_funded %in% c("TRUE", "True", "true", "Yes"), "Hub-funded", "Non-hub-funded"),
      asset_rank_num = suppressWarnings(as.integer(asset_rank)),
      type_bucket = case_when(
        type_norm %in% c("CGIAR-produced", "Co-produced", "External") ~ type_norm,
        is.na(type_norm) ~ "Not specified",
        TRUE ~ "Specialized / mixed"
      ),
      readiness_norm = recode(
        technical_readiness,
        "Medium–High" = "Medium-High",
        .default = technical_readiness
      ),
      validity_norm = recode(
        contemporary_validity,
        "Medium–High" = "Medium-High",
        .default = contemporary_validity
      ),
      reuse_norm = recode(
        reuse_potential,
        "high" = "High",
        "Medium–High" = "Medium-High",
        .default = reuse_potential
      ),
      sustainability_norm = recode(
        sustainability,
        "high" = "High",
        .default = sustainability
      ),
      asset_type_display = coalesce(type_norm, asset_type, "Not specified"),
      label = paste0(name, " (", centre, ")")
    )
}

assets <- load_assets(assets_path)

group_choices <- c(
  "Centre" = "centre",
  "Climate domain" = "domain_norm",
  "Asset type bucket" = "type_bucket",
  "Detailed asset type" = "asset_type_display",
  "Geographic coverage" = "geo_norm",
  "Hub-funded status" = "hub_funded",
  "Asset rank" = "asset_rank",
  "Technical readiness" = "readiness_norm",
  "Reuse potential" = "reuse_norm",
  "Sustainability" = "sustainability_norm",
  "Intended hub role" = "hub_role"
)

dashboard_theme <- bs_theme(
  version = 5,
  bootswatch = "minty",
  primary = "#1955A6",
  secondary = "#5C6B73",
  success = "#0B6E4F",
  info = "#1F8A70",
  base_font = font_google("Source Sans 3"),
  heading_font = font_google("IBM Plex Sans")
)

bar_plot <- function(data, var, fill_var = NULL, top_n = 12, mode = "count") {
  var_sym <- sym(var)
  fill_sym <- if (!is.null(fill_var) && nzchar(fill_var)) sym(fill_var) else NULL

  grouped <- data |>
    mutate(.group = coalesce(as.character(!!var_sym), "Not specified")) |>
    filter(!is.na(.group)) |>
    count(.group, sort = TRUE, name = "n")

  groups <- head(grouped$.group, top_n)
  plot_data <- data |>
    mutate(.group = coalesce(as.character(!!var_sym), "Not specified")) |>
    filter(.group %in% groups)

  if (is.null(fill_sym)) {
    plot_data <- plot_data |>
      count(.group, name = "n") |>
      mutate(.group = reorder(.group, n))

    ggplot(plot_data, aes(x = .group, y = n)) +
      geom_col(fill = "#1955A6", width = 0.75) +
      coord_flip() +
      scale_y_continuous(labels = comma) +
      labs(x = NULL, y = "Assets") +
      theme_minimal(base_size = 12) +
      theme(panel.grid.minor = element_blank())
  } else {
    plot_data <- plot_data |>
      mutate(.fill = coalesce(as.character(!!fill_sym), "Not specified")) |>
      count(.group, .fill, name = "n")

    if (identical(mode, "share")) {
      plot_data <- plot_data |>
        group_by(.group) |>
        mutate(value = n / sum(n)) |>
        ungroup()
      y_lab <- "Share within group"
      y_scale <- scale_y_continuous(labels = percent_format(accuracy = 1))
      position <- "fill"
    } else {
      plot_data <- mutate(plot_data, value = n)
      y_lab <- "Assets"
      y_scale <- scale_y_continuous(labels = comma)
      position <- "stack"
    }

    plot_data <- plot_data |>
      mutate(.group = factor(.group, levels = rev(groups)))

    ggplot(plot_data, aes(x = .group, y = value, fill = .fill)) +
      geom_col(position = position, width = 0.75) +
      coord_flip() +
      y_scale +
      labs(x = NULL, y = y_lab, fill = names(group_choices[group_choices == fill_var])) +
      theme_minimal(base_size = 12) +
      theme(panel.grid.minor = element_blank(), legend.position = "bottom")
  }
}

heatmap_plot <- function(data) {
  heatmap_data <- data |>
    count(centre, domain_norm, name = "n")

  centre_levels <- heatmap_data |>
    group_by(centre) |>
    summarise(total = sum(n), .groups = "drop") |>
    arrange(desc(total)) |>
    pull(centre)

  domain_levels <- heatmap_data |>
    group_by(domain_norm) |>
    summarise(total = sum(n), .groups = "drop") |>
    arrange(desc(total)) |>
    pull(domain_norm)

  heatmap_data <- heatmap_data |>
    mutate(
      centre = factor(centre, levels = rev(centre_levels)),
      domain_norm = factor(domain_norm, levels = domain_levels)
    )

  ggplot(heatmap_data, aes(x = domain_norm, y = centre, fill = n)) +
    geom_tile(color = "white") +
    geom_text(aes(label = n), size = 3) +
    scale_fill_gradient(low = "#E8EDF3", high = "#1955A6") +
    labs(x = NULL, y = NULL, fill = "Assets") +
    theme_minimal(base_size = 12) +
    theme(
      axis.text.x = element_text(angle = 35, hjust = 1),
      panel.grid = element_blank()
    )
}

detail_block <- function(label, value) {
  if (is.null(value) || is.na(value) || !nzchar(value)) {
    return(NULL)
  }

  div(
    class = "mb-3",
    tags$div(class = "text-uppercase text-muted small fw-semibold", label),
    tags$div(value)
  )
}

ui <- page_sidebar(
  title = "CDH Asset Explorer",
  theme = dashboard_theme,
  sidebar = sidebar(
    width = 340,
    tags$p(
      class = "text-muted",
      "Subset, compare, plot, and inspect climate data assets across centres."
    ),
    textInput("search", "Search asset name or description", placeholder = "e.g. hazard, Mali, crop model"),
    selectizeInput("centre", "Centre", choices = sort(unique(assets$centre)), multiple = TRUE),
    selectizeInput("domain", "Climate domain", choices = sort(unique(assets$domain_norm)), multiple = TRUE),
    selectizeInput("type", "Asset type bucket", choices = sort(unique(assets$type_bucket)), multiple = TRUE),
    selectizeInput("geo", "Geographic coverage", choices = sort(unique(assets$geo_norm)), multiple = TRUE),
    selectizeInput("hub", "Hub-funded status", choices = sort(unique(assets$hub_funded)), multiple = TRUE),
    sliderInput(
      "asset_rank",
      "Asset rank range",
      min = min(assets$asset_rank_num, na.rm = TRUE),
      max = max(assets$asset_rank_num, na.rm = TRUE),
      value = c(min(assets$asset_rank_num, na.rm = TRUE), max(assets$asset_rank_num, na.rm = TRUE)),
      step = 1
    ),
    checkboxInput("hide_unspecified", "Hide 'Not specified' values in charts", FALSE),
    actionButton("reset_filters", "Reset filters", class = "btn-primary")
  ),
  layout_columns(
    fill = FALSE,
    value_box(title = "Filtered assets", value = textOutput("n_assets"), theme = value_box_theme(bg = "#1955A6", fg = "white")),
    value_box(title = "Centres represented", value = textOutput("n_centres"), theme = value_box_theme(bg = "#0B6E4F", fg = "white")),
    value_box(title = "Domains represented", value = textOutput("n_domains"), theme = value_box_theme(bg = "#1F8A70", fg = "white")),
    value_box(title = "Hub-funded share", value = textOutput("hub_share"), theme = value_box_theme(bg = "#5C6B73", fg = "white"))
  ),
  navset_card_tab(
    nav_panel(
      "Overview",
      layout_columns(
        card(full_screen = TRUE, card_header("Assets by centre"), plotOutput("centre_plot", height = 380)),
        card(full_screen = TRUE, card_header("Assets by climate domain"), plotOutput("domain_plot", height = 380))
      ),
      layout_columns(
        card(full_screen = TRUE, card_header("Assets by type bucket"), plotOutput("type_plot", height = 320)),
        card(full_screen = TRUE, card_header("Assets by geographic coverage"), plotOutput("geo_plot", height = 320))
      ),
      card(
        full_screen = TRUE,
        card_header("Centre × domain heatmap"),
        plotOutput("heatmap_plot", height = 520)
      )
    ),
    nav_panel(
      "Chart builder",
      layout_sidebar(
        sidebar = sidebar(
          width = 280,
          selectInput("group_var", "Group assets by", choices = group_choices, selected = "centre"),
          selectInput("fill_var", "Stack / split by", choices = c("None" = "", group_choices), selected = "domain_norm"),
          radioButtons("metric", "Metric", choices = c("Count" = "count", "Share within group" = "share"), inline = FALSE),
          sliderInput("top_n", "Top groups to show", min = 5, max = 20, value = 12, step = 1)
        ),
        card(
          full_screen = TRUE,
          card_header("Custom comparison plot"),
          plotOutput("custom_plot", height = 560)
        )
      )
    ),
    nav_panel(
      "Explore table",
      card(
        full_screen = TRUE,
        card_header(
          "Filtered asset table",
          downloadButton("download_csv", "Download CSV"),
          downloadButton("download_json", "Download JSON")
        ),
        DTOutput("asset_table")
      )
    ),
    nav_panel(
      "Asset detail",
      selectizeInput("asset_choice", "Choose asset", choices = assets$label, selected = assets$label[[1]]),
      card(
        full_screen = TRUE,
        card_header(textOutput("detail_title")),
        uiOutput("detail_ui")
      )
    )
  )
)

server <- function(input, output, session) {
  observeEvent(input$reset_filters, {
    updateTextInput(session, "search", value = "")
    updateSelectizeInput(session, "centre", selected = character(0))
    updateSelectizeInput(session, "domain", selected = character(0))
    updateSelectizeInput(session, "type", selected = character(0))
    updateSelectizeInput(session, "geo", selected = character(0))
    updateSelectizeInput(session, "hub", selected = character(0))
    updateSliderInput(
      session,
      "asset_rank",
      value = c(min(assets$asset_rank_num, na.rm = TRUE), max(assets$asset_rank_num, na.rm = TRUE))
    )
    updateCheckboxInput(session, "hide_unspecified", value = FALSE)
  })

  filtered_assets <- reactive({
    data <- assets

    if (nzchar(input$search %||% "")) {
      needle <- str_to_lower(input$search)
      haystack <- str_to_lower(paste(data$name, data$short_description, data$centre, data$domain_norm))
      data <- data[str_detect(haystack, fixed(needle)), , drop = FALSE]
    }

    if (length(input$centre)) {
      data <- filter(data, centre %in% input$centre)
    }
    if (length(input$domain)) {
      data <- filter(data, domain_norm %in% input$domain)
    }
    if (length(input$type)) {
      data <- filter(data, type_bucket %in% input$type)
    }
    if (length(input$geo)) {
      data <- filter(data, geo_norm %in% input$geo)
    }
    if (length(input$hub)) {
      data <- filter(data, hub_funded %in% input$hub)
    }

    data |>
      filter(
        is.na(asset_rank_num) |
          (asset_rank_num >= input$asset_rank[1] & asset_rank_num <= input$asset_rank[2])
      )
  })

  chart_assets <- reactive({
    data <- filtered_assets()

    if (isTRUE(input$hide_unspecified)) {
      data <- data |>
        filter(
          domain_norm != "Not specified",
          geo_norm != "Not specified",
          type_bucket != "Not specified"
        )
    }

    data
  })

  observe({
    updateSelectizeInput(
      session,
      "asset_choice",
      choices = filtered_assets()$label,
      selected = filtered_assets()$label[[1]] %||% character(0)
    )
  })

  output$n_assets <- renderText(comma(nrow(filtered_assets())))
  output$n_centres <- renderText(length(unique(filtered_assets()$centre)))
  output$n_domains <- renderText(length(unique(filtered_assets()$domain_norm)))
  output$hub_share <- renderText({
    data <- filtered_assets()
    if (!nrow(data)) return("0%")
    pct(sum(data$hub_funded == "Hub-funded") / nrow(data), accuracy = 1)
  })

  output$centre_plot <- renderPlot({
    req(nrow(chart_assets()) > 0)
    bar_plot(chart_assets(), "centre", top_n = 20)
  })

  output$domain_plot <- renderPlot({
    req(nrow(chart_assets()) > 0)
    bar_plot(chart_assets(), "domain_norm", top_n = 20)
  })

  output$type_plot <- renderPlot({
    req(nrow(chart_assets()) > 0)
    bar_plot(chart_assets(), "type_bucket", top_n = 20)
  })

  output$geo_plot <- renderPlot({
    req(nrow(chart_assets()) > 0)
    bar_plot(chart_assets(), "geo_norm", top_n = 20)
  })

  output$heatmap_plot <- renderPlot({
    req(nrow(chart_assets()) > 0)
    heatmap_plot(chart_assets())
  })

  output$custom_plot <- renderPlot({
    req(nrow(chart_assets()) > 0)
    bar_plot(
      chart_assets(),
      input$group_var,
      fill_var = if (nzchar(input$fill_var)) input$fill_var else NULL,
      top_n = input$top_n,
      mode = input$metric
    )
  })

  output$asset_table <- renderDT({
    data <- filtered_assets() |>
      transmute(
        Asset = name,
        Centre = centre,
        Domain = domain_norm,
        Type = type_bucket,
        `Detailed type` = asset_type_display,
        Geography = geo_norm,
        `Hub-funded` = hub_funded,
        `Asset rank` = asset_rank,
        `Hub role` = hub_role,
        `Last updated` = year_last_updated,
        Description = short_description
      )

    datatable(
      data,
      filter = "top",
      selection = "single",
      extensions = "Buttons",
      options = list(
        pageLength = 12,
        autoWidth = TRUE,
        scrollX = TRUE,
        dom = "Bfrtip",
        buttons = c("copy", "csv")
      )
    )
  })

  observeEvent(input$asset_table_rows_selected, {
    row_id <- input$asset_table_rows_selected
    data <- filtered_assets()
    if (length(row_id) == 1 && nrow(data) >= row_id) {
      updateSelectizeInput(session, "asset_choice", selected = data$label[[row_id]])
    }
  })

  selected_asset <- reactive({
    req(input$asset_choice)
    filtered_assets() |>
      filter(label == input$asset_choice) |>
      slice(1)
  })

  output$detail_title <- renderText({
    req(nrow(selected_asset()) == 1)
    paste0(selected_asset()$name[[1]], " — ", selected_asset()$centre[[1]])
  })

  output$detail_ui <- renderUI({
    req(nrow(selected_asset()) == 1)
    asset <- selected_asset()

    div(
      class = "p-2",
      tags$p(class = "lead", asset$short_description[[1]] %||% "No description available."),
      layout_columns(
        col_widths = c(6, 6),
        card(
          card_header("Classification"),
          detail_block("Climate domain", asset$domain_norm[[1]]),
          detail_block("Asset type bucket", asset$type_bucket[[1]]),
          detail_block("Detailed type", asset$asset_type_display[[1]]),
          detail_block("Geographic coverage", asset$geo_norm[[1]]),
          detail_block("Hub-funded status", asset$hub_funded[[1]])
        ),
        card(
          card_header("Readiness and use"),
          detail_block("Asset rank", asset$asset_rank[[1]]),
          detail_block("Technical readiness", asset$readiness_norm[[1]]),
          detail_block("Contemporary validity", asset$validity_norm[[1]]),
          detail_block("Reuse potential", asset$reuse_norm[[1]]),
          detail_block("Sustainability", asset$sustainability_norm[[1]]),
          detail_block("Hub role", asset$hub_role[[1]])
        )
      ),
      layout_columns(
        col_widths = c(6, 6),
        card(
          card_header("Content and scope"),
          detail_block("Commodity", asset$commodity[[1]]),
          detail_block("Farming system", asset$farming_system[[1]]),
          detail_block("Spatial coverage", asset$spatial_coverage[[1]]),
          detail_block("Spatial resolution", asset$spatial_resolution[[1]]),
          detail_block("Temporal type", asset$temporal_type[[1]]),
          detail_block("Year last updated", as.character(asset$year_last_updated[[1]]))
        ),
        card(
          card_header("Context"),
          detail_block("Nominator", asset$nominator[[1]]),
          detail_block("Decision relevance", asset$decision_relevance[[1]]),
          detail_block("Reuse potential note", asset$reuse_potential[[1]]),
          detail_block("Climate domain submitted", asset$climate_domain[[1]])
        )
      )
    )
  })

  output$download_csv <- downloadHandler(
    filename = function() {
      paste0("cdh_assets_filtered_", Sys.Date(), ".csv")
    },
    content = function(file) {
      write.csv(filtered_assets(), file, row.names = FALSE, na = "")
    }
  )

  output$download_json <- downloadHandler(
    filename = function() {
      paste0("cdh_assets_filtered_", Sys.Date(), ".json")
    },
    content = function(file) {
      write_json(filtered_assets(), file, pretty = TRUE, auto_unbox = TRUE, na = "null")
    }
  )
}

shinyApp(ui, server)
