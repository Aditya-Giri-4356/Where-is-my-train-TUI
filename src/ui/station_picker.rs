use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use crate::app::App;
use super::widgets::Theme;

/// Draw the station picker overlay screen
pub fn draw_station_picker(f: &mut Frame, app: &App) {
    let size = f.area();

    // Clear background
    let bg = Block::default().style(Style::default().bg(Theme::BG));
    f.render_widget(bg, size);

    // Layout: Header (3) + Search (3) + Results (flex) + Selected (3) + Keyboard hint (3)
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),  // Header
            Constraint::Length(3),  // Search input
            Constraint::Min(5),    // Station list
            Constraint::Length(3), // Selected station display
            Constraint::Length(3), // Keyboard space / help
        ])
        .split(size);

    // ─── Header ─────────────────────────────────────────────────
    let field_label = match &app.screen {
        crate::app::Screen::StationPicker(crate::app::PickerField::From) => "FROM",
        crate::app::Screen::StationPicker(crate::app::PickerField::To) => "TO",
        _ => "STATION",
    };

    let dashes = "─".repeat(size.width.saturating_sub(field_label.len() as u16 + 6) as usize);
    let header_text = format!(" {}:{} ", field_label, dashes);

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

    // ─── Search input ───────────────────────────────────────────
    let search_display = if app.picker_search.is_empty() {
        "Type station name or code...".to_string()
    } else {
        app.picker_search.clone()
    };

    let search_color = if app.picker_search.is_empty() {
        Theme::DIM
    } else {
        Theme::FG
    };

    let search = Paragraph::new(Line::from(vec![
        Span::styled(" 🔍 ", Style::default().fg(Theme::ACCENT)),
        Span::styled(search_display, Style::default().fg(search_color)),
        Span::styled("█", Style::default().fg(Theme::ACCENT)), // cursor
    ]))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Theme::BORDER))
            .style(Style::default().bg(Theme::BG)),
    );
    f.render_widget(search, chunks[1]);

    // ─── Station list ───────────────────────────────────────────
    let list_area = chunks[2];
    let visible_height = list_area.height.saturating_sub(2) as usize;

    // Ensure selected item is visible (auto-scroll)
    let scroll = if app.picker_selected >= visible_height {
        app.picker_selected - visible_height + 1
    } else {
        0
    };

    let mut list_lines: Vec<Line> = Vec::new();

    for (i, (code, name)) in app.picker_results.iter().enumerate() {
        if i < scroll {
            continue;
        }
        if list_lines.len() >= visible_height {
            break;
        }

        let is_selected = i == app.picker_selected;
        let prefix = if is_selected { " ▸ " } else { "   " };

        let style = if is_selected {
            Style::default()
                .fg(Theme::CURRENT)
                .bg(Theme::SELECTED_BG)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Theme::FG)
        };

        let code_style = if is_selected {
            Style::default()
                .fg(Theme::ACCENT)
                .bg(Theme::SELECTED_BG)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Theme::DIM)
        };

        let line = Line::from(vec![
            Span::styled(prefix, style),
            Span::styled(format!("{:<5}", code), code_style),
            Span::styled(" ", style),
            Span::styled(name.clone(), style),
        ]);
        list_lines.push(line);
    }

    let list_block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Theme::BORDER))
        .style(Style::default().bg(Theme::BG));

    let list_widget = Paragraph::new(list_lines).block(list_block);
    f.render_widget(list_widget, list_area);

    // ─── Selected station display ───────────────────────────────
    let selected_text = if let Some((code, name)) = app.picker_results.get(app.picker_selected) {
        format!(" STATION: {} — {} ", code, name)
    } else {
        " STATION: (none selected) ".to_string()
    };

    let selected = Paragraph::new(Line::from(vec![
        Span::styled(
            selected_text,
            Style::default()
                .fg(Theme::ACCENT)
                .add_modifier(Modifier::BOLD),
        ),
    ]))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Theme::BORDER))
            .style(Style::default().bg(Theme::HEADER_BG)),
    );
    f.render_widget(selected, chunks[3]);

    // ─── Keyboard hint / space ──────────────────────────────────
    let help_text = " ↑↓ Navigate │ ENTER Select │ ESC Back │ Type to search ";
    let help = Paragraph::new(Line::from(vec![
        Span::styled(help_text, Style::default().fg(Theme::DIM)),
    ]))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Theme::BORDER))
            .style(Style::default().bg(Theme::BG)),
    );
    f.render_widget(help, chunks[4]);
}
