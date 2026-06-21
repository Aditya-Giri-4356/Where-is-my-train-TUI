use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use crate::api::types::TrackStation;

/// Colors for the TUI theme (dark terminal aesthetic)
pub struct Theme;

impl Theme {
    pub const BG: Color = Color::Rgb(24, 24, 32);
    pub const FG: Color = Color::Rgb(200, 200, 210);
    pub const BORDER: Color = Color::Rgb(60, 60, 75);
    pub const BORDER_HL: Color = Color::Rgb(100, 140, 255);
    pub const TITLE: Color = Color::Rgb(140, 180, 255);
    pub const ACCENT: Color = Color::Rgb(100, 220, 160);
    pub const WARN: Color = Color::Rgb(255, 200, 80);
    pub const ERR: Color = Color::Rgb(255, 100, 100);
    pub const DIM: Color = Color::Rgb(100, 100, 120);
    pub const CURRENT: Color = Color::Rgb(80, 255, 180);
    pub const PASSED: Color = Color::Rgb(80, 160, 100);
    pub const UPCOMING: Color = Color::Rgb(120, 120, 140);
    pub const SELECTED_BG: Color = Color::Rgb(40, 50, 80);
    pub const HEADER_BG: Color = Color::Rgb(30, 30, 45);
}

/// Draw the station timeline (vertical track with nodes)
pub fn draw_timeline(f: &mut Frame, area: Rect, timeline: &[TrackStation], scroll: usize) {
    if area.height < 3 || area.width < 10 {
        return;
    }

    let visible_height = (area.height as usize).saturating_sub(2);
    let mut lines: Vec<Line> = Vec::new();

    for (i, point) in timeline.iter().enumerate() {
        // Only show stoppages (skip intermediate)
        if !point.is_stopping {
            continue;
        }

        let (node_char, _node_color) = match point.status.as_str() {
            "passed" => ("✓", Theme::PASSED),
            "current" => ("●", Theme::CURRENT),
            _ => ("○", Theme::UPCOMING),
        };

        let name_style = match point.status.as_str() {
            "current" => Style::default().fg(Theme::CURRENT).add_modifier(Modifier::BOLD),
            "passed" => Style::default().fg(Theme::PASSED),
            _ => Style::default().fg(Theme::FG),
        };

        // Station name line
        let station_label = format!(
            " {} {} ({})",
            node_char, point.station_name, point.station_code
        );
        lines.push(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(station_label, name_style),
        ]));

        let arr_str = if point.actual_arrival != "--" { &point.actual_arrival } else { &point.scheduled_arrival };
        let dep_str = if point.actual_departure != "--" { &point.actual_departure } else { &point.scheduled_departure };

        let delay_str = if let Some(m) = point.delay_minutes {
            if m == 0 { "On Time".to_string() } else { format!("{} min late", m) }
        } else {
            "".to_string()
        };

        let delay_color = if delay_str == "On Time" || delay_str.is_empty() {
            Theme::ACCENT
        } else {
            Theme::WARN
        };

        let detail = format!(
            "       ARR {} │ DEP {}",
            arr_str, dep_str
        );
        lines.push(Line::from(vec![
            Span::styled(detail, Style::default().fg(Theme::DIM)),
        ]));

        if !delay_str.is_empty() {
            let delay_line = format!("       ⏱ {}", delay_str);
            lines.push(Line::from(vec![
                Span::styled(delay_line, Style::default().fg(delay_color)),
            ]));
        }

        // Connector line between stations
        if i < timeline.len().saturating_sub(1) {
            lines.push(Line::from(vec![
                Span::styled("  │", Style::default().fg(Theme::BORDER)),
            ]));
        }
    }

    // Apply scroll
    let start = scroll.min(lines.len().saturating_sub(1));
    let visible: Vec<Line> = lines.into_iter().skip(start).take(visible_height).collect();

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Theme::BORDER))
        .title(Span::styled(
            " 🚂 LIVE STATION TIMELINE ",
            Style::default().fg(Theme::TITLE).add_modifier(Modifier::BOLD),
        ));

    let paragraph = Paragraph::new(visible).block(block);
    f.render_widget(paragraph, area);
}

/// Draw a styled status bar
pub fn draw_status_bar(f: &mut Frame, area: Rect, msg: &str, is_error: bool) {
    let color = if is_error { Theme::ERR } else { Theme::ACCENT };
    let bar = Paragraph::new(Line::from(vec![
        Span::styled(" ", Style::default()),
        Span::styled(msg, Style::default().fg(color)),
    ]))
    .style(Style::default().bg(Theme::HEADER_BG));

    f.render_widget(bar, area);
}

/// Draw a centered loading indicator
pub fn draw_loading(f: &mut Frame, area: Rect, msg: &str) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Theme::BORDER));

    let text = Paragraph::new(Line::from(vec![
        Span::styled(
            format!("  ⏳ {} ", msg),
            Style::default()
                .fg(Theme::WARN)
                .add_modifier(Modifier::BOLD),
        ),
    ]))
    .block(block)
    .style(Style::default().bg(Theme::BG));

    f.render_widget(text, area);
}
