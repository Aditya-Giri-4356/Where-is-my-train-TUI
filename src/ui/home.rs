use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use crate::app::App;
use super::widgets::{self, Theme};
use ratatui::style::Color;

fn days_spans(running_days: &str) -> Vec<Span<'static>> {
    // running_days is a 7-char string like "1111111" or "1000001"
    // or a text like "Daily" / "MON TUE" etc.
    let day_labels = ["S", "M", "T", "W", "T", "F", "S"];
    let mut spans = vec![Span::raw("  ")];
    
    let bits: Vec<bool> = if running_days.len() == 7 && running_days.chars().all(|c| c == '0' || c == '1') {
        running_days.chars().map(|c| c == '1').collect()
    } else if running_days.to_uppercase().contains("DAILY") || running_days == "1111111" {
        vec![true; 7]
    } else {
        // Try to match day names
        let upper = running_days.to_uppercase();
        vec![
            upper.contains("SUN"), upper.contains("MON"), upper.contains("TUE"),
            upper.contains("WED"), upper.contains("THU"), upper.contains("FRI"),
            upper.contains("SAT"),
        ]
    };

    for (i, &runs) in bits.iter().enumerate() {
        let style = if runs {
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::DarkGray)
        };
        spans.push(Span::styled(day_labels[i].to_string(), style));
        if i < 6 { spans.push(Span::raw("  ")); }
    }
    spans
}

fn format_running_days(running_days: &str) -> String {
    running_days.to_string() // passthrough; days_spans handles the rendering
}

/// Draw the main home screen (matching the wireframe)
pub fn draw_home(f: &mut Frame, app: &App) {
    let size = f.area();

    // Clear background
    let bg = Block::default().style(Style::default().bg(Theme::BG));
    f.render_widget(bg, size);

    // Layout: Title (3) + FROM/TO (5) + Info area (flex) + Status (1)
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Title bar
            Constraint::Length(5), // FROM / TO boxes
            Constraint::Min(10),  // Main content area
            Constraint::Length(1), // Status bar
        ])
        .split(size);

    // ─── Title bar ──────────────────────────────────────────────
    let title = Paragraph::new(Line::from(vec![
        Span::styled(
            " 🚂 WHERE IS MY TRAIN TUI ",
            Style::default()
                .fg(Theme::TITLE)
                .add_modifier(Modifier::BOLD),
        ),
    ]))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Theme::BORDER_HL))
            .style(Style::default().bg(Theme::HEADER_BG)),
    );
    f.render_widget(title, chunks[0]);

    // ─── FROM / TO boxes (side by side) ─────────────────────────
    let station_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(chunks[1]);

    // FROM box
    let from_display = if app.from_code.is_empty() {
        "(tap to select)".to_string()
    } else {
        format!("{} — {}", app.from_code, app.from_name)
    };
    let from_color = if app.from_code.is_empty() {
        Theme::DIM
    } else {
        Theme::ACCENT
    };

    let from_block = Paragraph::new(vec![
        Line::from(vec![
            Span::styled(
                " FROM:",
                Style::default()
                    .fg(Theme::TITLE)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(vec![
            Span::styled(format!(" {}", from_display), Style::default().fg(from_color)),
        ]),
    ])
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Theme::BORDER))
            .style(Style::default().bg(Theme::BG)),
    );
    f.render_widget(from_block, station_chunks[0]);

    // TO box
    let to_display = if app.to_code.is_empty() {
        "(tap to select)".to_string()
    } else {
        format!("{} — {}", app.to_code, app.to_name)
    };
    let to_color = if app.to_code.is_empty() {
        Theme::DIM
    } else {
        Theme::ACCENT
    };

    let to_block = Paragraph::new(vec![
        Line::from(vec![
            Span::styled(
                " TO:",
                Style::default()
                    .fg(Theme::TITLE)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(vec![
            Span::styled(format!(" {}", to_display), Style::default().fg(to_color)),
        ]),
    ])
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Theme::BORDER))
            .style(Style::default().bg(Theme::BG)),
    );
    f.render_widget(to_block, station_chunks[1]);

    // ─── Main content area ──────────────────────────────────────
    let content_area = chunks[2];

    if app.from_code.is_empty() || app.to_code.is_empty() {
        // Show welcome / instructions
        draw_welcome(f, content_area);
    } else {
        // Show search prompt
        draw_search_prompt(f, content_area, app);
    }

    // ─── Status bar ─────────────────────────────────────────────
    let is_error = app.status_msg.contains("Error") || app.status_msg.contains("⚠");
    widgets::draw_status_bar(f, chunks[3], &app.status_msg, is_error);
}

/// Draw welcome/instructions when no stations are selected
fn draw_welcome(f: &mut Frame, area: Rect) {
    let lines = vec![
        Line::from(""),
        Line::from(vec![Span::styled(
            "  Welcome to Where Is My Train!",
            Style::default()
                .fg(Theme::TITLE)
                .add_modifier(Modifier::BOLD),
        )]),
        Line::from(""),
        Line::from(vec![Span::styled(
            "  Track Indian Railways trains in real-time",
            Style::default().fg(Theme::FG),
        )]),
        Line::from(""),
        Line::from(vec![Span::styled(
            "  ┌─────────────────────────────────────────┐",
            Style::default().fg(Theme::BORDER),
        )]),
        Line::from(vec![Span::styled(
            "  │  1. Press [F] or click FROM to select   │",
            Style::default().fg(Theme::ACCENT),
        )]),
        Line::from(vec![Span::styled(
            "  │  2. Press [T] or click TO to select     │",
            Style::default().fg(Theme::ACCENT),
        )]),
        Line::from(vec![Span::styled(
            "  │  3. Press [ENTER] to search trains      │",
            Style::default().fg(Theme::ACCENT),
        )]),
        Line::from(vec![Span::styled(
            "  │  4. Select a train to track live         │",
            Style::default().fg(Theme::ACCENT),
        )]),
        Line::from(vec![Span::styled(
            "  └─────────────────────────────────────────┘",
            Style::default().fg(Theme::BORDER),
        )]),
        Line::from(""),
        Line::from(vec![Span::styled(
            "  Controls: [F] From  [T] To  [ENTER] Search  [Q] Quit",
            Style::default().fg(Theme::DIM),
        )]),
        Line::from(vec![Span::styled(
            "  Touch: Tap on FROM/TO boxes to select stations",
            Style::default().fg(Theme::DIM),
        )]),
    ];

    let widget = Paragraph::new(lines).block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Theme::BORDER))
            .style(Style::default().bg(Theme::BG)),
    );
    f.render_widget(widget, area);
}

/// Draw search prompt when both stations are selected
fn draw_search_prompt(f: &mut Frame, area: Rect, app: &App) {
    let lines = vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("  Route: ", Style::default().fg(Theme::DIM)),
            Span::styled(
                &app.from_code,
                Style::default()
                    .fg(Theme::ACCENT)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(" → ", Style::default().fg(Theme::TITLE)),
            Span::styled(
                &app.to_code,
                Style::default()
                    .fg(Theme::ACCENT)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(vec![
            Span::styled(
                format!("  {} → {}", app.from_name, app.to_name),
                Style::default().fg(Theme::FG),
            ),
        ]),
        Line::from(""),
        Line::from(vec![Span::styled(
            "  Press [ENTER] to search trains on this route",
            Style::default()
                .fg(Theme::WARN)
                .add_modifier(Modifier::BOLD),
        )]),
        Line::from(""),
        Line::from(vec![Span::styled(
            "  [F] Change FROM  [T] Change TO  [Q] Quit",
            Style::default().fg(Theme::DIM),
        )]),
    ];

    let widget = Paragraph::new(lines).block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Theme::BORDER))
            .title(Span::styled(
                " JOURNEY ",
                Style::default()
                    .fg(Theme::TITLE)
                    .add_modifier(Modifier::BOLD),
            ))
            .style(Style::default().bg(Theme::BG)),
    );
    f.render_widget(widget, area);
}

/// Draw the train selection screen
pub fn draw_train_select(f: &mut Frame, app: &App) {
    let size = f.area();

    let bg = Block::default().style(Style::default().bg(Theme::BG));
    f.render_widget(bg, size);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Header
            Constraint::Min(5),   // Train list
            Constraint::Length(3), // Help bar
            Constraint::Length(1), // Status
        ])
        .split(size);

    // ─── Header ─────────────────────────────────────────────────
    let header_text = format!(
        " 🔍 TRAINS: {} → {} ({} found) ",
        app.from_code,
        app.to_code,
        app.search_results.len()
    );
    let header = Paragraph::new(Line::from(vec![
        Span::styled(
            header_text,
            Style::default()
                .fg(Theme::TITLE)
                .add_modifier(Modifier::BOLD),
        ),
    ]))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Theme::BORDER_HL))
            .style(Style::default().bg(Theme::HEADER_BG)),
    );
    f.render_widget(header, chunks[0]);

    // ─── Train list ─────────────────────────────────────────────
    if let Some(ref err) = app.search_error {
        let error_widget = Paragraph::new(vec![
            Line::from(""),
            Line::from(vec![Span::styled(
                format!("  ⚠ {}", err),
                Style::default().fg(Theme::ERR),
            )]),
        ])
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Theme::BORDER))
                .style(Style::default().bg(Theme::BG)),
        );
        f.render_widget(error_widget, chunks[1]);
    } else {
        let list_area = chunks[1];
        let visible_height = list_area.height.saturating_sub(2) as usize;
        let lines_per_item = 4;
        let max_visible = visible_height / lines_per_item;

        let scroll = if app.search_selected >= max_visible {
            app.search_selected - max_visible + 1
        } else {
            0
        };

        let mut lines: Vec<Line> = Vec::new();

        for (i, train) in app.search_results.iter().enumerate() {
            if i < scroll {
                continue;
            }
            if lines.len() / lines_per_item >= max_visible {
                break;
            }

            let is_selected = i == app.search_selected;
            let bg_style = if is_selected {
                Style::default().bg(Theme::SELECTED_BG)
            } else {
                Style::default()
            };

            let prefix = if is_selected { " ▸ " } else { "   " };
            let name_color = if is_selected { Theme::CURRENT } else { Theme::FG };

            // Line 1: Train number + name
            lines.push(Line::from(vec![
                Span::styled(prefix, bg_style.fg(name_color)),
                Span::styled(
                    format!(" {} ", train.train_no),
                    Style::default().bg(Theme::ACCENT).fg(Color::Black).add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!("  {}", train.train_name),
                    bg_style.fg(name_color).add_modifier(Modifier::BOLD),
                ),
            ]));

            // Line 2: Time + duration
            let dots = "·".repeat(8);
            let from_time = train.from_time.as_deref().unwrap_or("--:--");
            let to_time = train.to_time.as_deref().unwrap_or("--:--");
            let travel = train.travel_time.as_deref().unwrap_or("--");
            
            lines.push(Line::from(vec![
                Span::styled("     ", bg_style),
                Span::styled(from_time, bg_style.fg(Color::Green)),
                Span::styled(format!(" {} ", dots), bg_style.fg(Color::DarkGray)),
                Span::styled(travel, bg_style.fg(Color::Yellow)),
                Span::styled(format!(" {} ", dots), bg_style.fg(Color::DarkGray)),
                Span::styled(to_time, bg_style.fg(Color::Green)),
            ]));

            // Line 3: Running days
            let days_raw = train.running_days.as_deref().unwrap_or("1111111");
            let mut line3_spans = vec![Span::styled("     ", bg_style)];
            for span in days_spans(days_raw) {
                line3_spans.push(Span::styled(span.content, span.style.bg(bg_style.bg.unwrap_or(Color::Reset))));
            }
            lines.push(Line::from(line3_spans));

            // Line 4: Separator
            lines.push(Line::from(vec![
                Span::styled(
                    "     ──────────────────────────────────────────────",
                    Style::default().fg(Theme::BORDER),
                ),
            ]));
        }

        let list_widget = Paragraph::new(lines).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Theme::BORDER))
                .style(Style::default().bg(Theme::BG)),
        );
        f.render_widget(list_widget, list_area);
    }

    // ─── Help bar ───────────────────────────────────────────────
    let help = Paragraph::new(Line::from(vec![
        Span::styled(
            " ↑↓ Navigate │ ENTER Track │ ESC Back ",
            Style::default().fg(Theme::DIM),
        ),
    ]))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Theme::BORDER))
            .style(Style::default().bg(Theme::BG)),
    );
    f.render_widget(help, chunks[2]);

    // ─── Status ─────────────────────────────────────────────────
    let is_error = app.status_msg.contains("Error");
    widgets::draw_status_bar(f, chunks[3], &app.status_msg, is_error);
}

/// Draw the live tracking screen
pub fn draw_tracking(f: &mut Frame, app: &App) {
    let size = f.area();

    let bg = Block::default().style(Style::default().bg(Theme::BG));
    f.render_widget(bg, size);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Train info header
            Constraint::Length(3), // Status note
            Constraint::Min(8),   // Timeline
            Constraint::Length(3), // Help
            Constraint::Length(1), // Status bar
        ])
        .split(size);

    if let Some(ref data) = app.tracking_data {
        // ─── Train info header ──────────────────────────────────
        let header_text = format!(
            " 🚂 {} — {} ",
            app.tracking_train_no, data.train_name
        );
        let header = Paragraph::new(Line::from(vec![
            Span::styled(
                header_text,
                Style::default()
                    .fg(Theme::TITLE)
                    .add_modifier(Modifier::BOLD),
            ),
        ]))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Theme::BORDER_HL))
                .style(Style::default().bg(Theme::HEADER_BG)),
        );
        f.render_widget(header, chunks[0]);

        // ─── Status note ────────────────────────────────────────
        let status_note = data
            .current_station
            .as_deref()
            .unwrap_or("Position unknown");
        let last_update = data
            .current_delay
            .as_deref()
            .unwrap_or("--");

        let status = Paragraph::new(vec![
            Line::from(vec![
                Span::styled(
                    format!(" 📍 {} ", status_note),
                    Style::default()
                        .fg(Theme::ACCENT)
                        .add_modifier(Modifier::BOLD),
                ),
            ]),
            Line::from(vec![
                Span::styled(
                    format!(" Delay: {} ", last_update),
                    Style::default().fg(Theme::DIM),
                ),
            ]),
        ])
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Theme::BORDER))
                .style(Style::default().bg(Theme::BG)),
        );
        f.render_widget(status, chunks[1]);

        // ─── Timeline ───────────────────────────────────────────
        if data.stations.is_empty() {
            let msg = Paragraph::new(
                "No timeline data available.\nTrain may not be running today, or NTES did not return stop data.\nPress [R] to retry."
            )
            .style(Style::default().fg(Color::DarkGray))
            .wrap(ratatui::widgets::Wrap { trim: true });
            f.render_widget(msg, chunks[2]);
        } else {
            widgets::draw_timeline(f, chunks[2], &data.stations, app.tracking_scroll);
        }
    } else if let Some(ref err) = app.tracking_error {
        // Error state
        let error_header = Paragraph::new(Line::from(vec![
            Span::styled(
                format!(" 🚂 Train {} ", app.tracking_train_no),
                Style::default()
                    .fg(Theme::TITLE)
                    .add_modifier(Modifier::BOLD),
            ),
        ]))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Theme::BORDER_HL))
                .style(Style::default().bg(Theme::HEADER_BG)),
        );
        f.render_widget(error_header, chunks[0]);

        let error_widget = Paragraph::new(vec![
            Line::from(""),
            Line::from(vec![Span::styled(
                format!("  ⚠ {}", err),
                Style::default().fg(Theme::ERR),
            )]),
            Line::from(""),
            Line::from(vec![Span::styled(
                "  This train may not be running today.",
                Style::default().fg(Theme::DIM),
            )]),
            Line::from(vec![Span::styled(
                "  Press [R] to retry or [ESC] to go back.",
                Style::default().fg(Theme::DIM),
            )]),
        ])
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Theme::BORDER))
                .style(Style::default().bg(Theme::BG)),
        );

        // Merge status note + timeline areas for error
        let merged = Rect {
            x: chunks[1].x,
            y: chunks[1].y,
            width: chunks[1].width,
            height: chunks[1].height + chunks[2].height,
        };
        f.render_widget(error_widget, merged);
    } else {
        // Loading
        let merged = Rect {
            x: chunks[0].x,
            y: chunks[0].y,
            width: chunks[0].width,
            height: chunks[0].height + chunks[1].height + chunks[2].height,
        };
        
        let spinner_frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        let frame = spinner_frames[(app.tick_count as usize / 3) % spinner_frames.len()];
        let loading = Paragraph::new(vec![
            Line::from(""),
            Line::from(vec![
                Span::styled(format!("  {} ", frame), Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
                Span::styled("Contacting NTES... (this takes ~15s on first load)", Style::default().fg(Color::White)),
            ])
        ]).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Theme::BORDER))
                .style(Style::default().bg(Theme::BG)),
        );
        f.render_widget(loading, merged);
    }

    // ─── Help ───────────────────────────────────────────────────
    let help = Paragraph::new(Line::from(vec![
        Span::styled(
            " ↑↓ Scroll │ [R] Refresh │ ESC Back ",
            Style::default().fg(Theme::DIM),
        ),
    ]))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Theme::BORDER))
            .style(Style::default().bg(Theme::BG)),
    );
    f.render_widget(help, chunks[3]);

    // ─── Status bar ─────────────────────────────────────────────
    let is_error = app.status_msg.contains("Error");
    widgets::draw_status_bar(f, chunks[4], &app.status_msg, is_error);
}
