mod api;
mod app;
mod db;
mod ui;
mod utils;

use app::{App, PickerField, Screen};
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyModifiers, MouseButton, MouseEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::io;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Try to spawn the bridge server
    let bridge_child = spawn_bridge();

    // Give the bridge a moment to start
    if bridge_child.is_some() {
        std::thread::sleep(Duration::from_millis(1500));
    }

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Run app
    let result = run_app(&mut terminal);

    // Restore terminal
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    // Kill bridge server
    if let Some(mut child) = bridge_child {
        let _ = child.kill();
    }

    if let Err(err) = result {
        eprintln!("Error: {}", err);
    }

    Ok(())
}

/// Spawn the Node.js bridge server as a child process
fn spawn_bridge() -> Option<Child> {
    // Find the bridge directory relative to the executable or use a known path
    let bridge_dir = std::env::current_dir()
        .ok()
        .map(|d| d.join("bridge"))
        .unwrap_or_else(|| std::path::PathBuf::from("bridge"));

    if !bridge_dir.join("node_modules").exists() {
        eprintln!("Bridge node_modules not found. Run: cd bridge && npm install");
        return None;
    }

    Command::new("node")
        .arg("server.js")
        .current_dir(&bridge_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

/// Main event loop
fn run_app(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>) -> io::Result<()> {
    let mut app = App::new();

    loop {
        app.tick_count = app.tick_count.wrapping_add(1);
        
        // Poll for background tracking completion
        if let Some(rx) = &app.tracking_rx {
            if let Ok(result) = rx.try_recv() {
                match result {
                    Ok(resp) => {
                        if let Some(data) = resp.data {
                            app.tracking_data = Some(data);
                            app.status_msg = "Live tracking active".to_string();
                        } else {
                            app.tracking_error = resp.error.or(Some("No tracking data available".to_string()));
                            app.status_msg = "Tracking failed".to_string();
                        }
                    }
                    Err(e) => {
                        app.tracking_error = Some(e);
                        app.status_msg = "Error fetching live data".to_string();
                    }
                }
                app.tracking_loading = false;
                app.tracking_rx = None;
            }
        }

        // Draw
        terminal.draw(|f| ui::draw(f, &app))?;

        // Poll events with a timeout (allows for periodic refresh and spinner animation)
        if event::poll(Duration::from_millis(150))? {
            match event::read()? {
                Event::Key(key) => handle_key(&mut app, key),
                Event::Mouse(mouse) => handle_mouse(&mut app, mouse),
                Event::Resize(_, _) => {} // ratatui handles resize automatically
                _ => {}
            }
        }

        if app.should_quit {
            return Ok(());
        }
    }
}

/// Handle keyboard input
fn handle_key(app: &mut App, key: event::KeyEvent) {
    // Global: Ctrl+C or Ctrl+Q to quit
    if key.modifiers.contains(KeyModifiers::CONTROL)
        && (key.code == KeyCode::Char('c') || key.code == KeyCode::Char('q'))
    {
        app.should_quit = true;
        return;
    }

    match &app.screen {
        Screen::Home => handle_key_home(app, key),
        Screen::StationPicker(_) => handle_key_picker(app, key),
        Screen::TrainSelect => handle_key_train_select(app, key),
        Screen::Tracking => handle_key_tracking(app, key),
    }
}

fn handle_key_home(app: &mut App, key: event::KeyEvent) {
    match key.code {
        KeyCode::Char('q') | KeyCode::Char('Q') => app.should_quit = true,
        KeyCode::Char('f') | KeyCode::Char('F') => app.open_picker(PickerField::From),
        KeyCode::Char('t') | KeyCode::Char('T') => app.open_picker(PickerField::To),
        KeyCode::Enter => app.search_trains(),
        KeyCode::Esc => app.should_quit = true,
        _ => {}
    }
}

fn handle_key_picker(app: &mut App, key: event::KeyEvent) {
    match key.code {
        KeyCode::Esc => app.go_back(),
        KeyCode::Enter => app.select_station(),
        KeyCode::Up => app.picker_up(),
        KeyCode::Down => app.picker_down(),
        KeyCode::Backspace => {
            app.picker_search.pop();
            app.update_picker_results();
        }
        KeyCode::Char(c) => {
            app.picker_search.push(c);
            app.update_picker_results();
        }
        _ => {}
    }
}

fn handle_key_train_select(app: &mut App, key: event::KeyEvent) {
    match key.code {
        KeyCode::Esc => app.go_back(),
        KeyCode::Up => app.search_up(),
        KeyCode::Down => app.search_down(),
        KeyCode::Enter => {
            if let Some(train) = app.search_results.get(app.search_selected).cloned() {
                let train_no = train.train_no.clone();
                app.track_train(&train_no);
            }
        }
        KeyCode::Char('q') | KeyCode::Char('Q') => app.should_quit = true,
        _ => {}
    }
}

fn handle_key_tracking(app: &mut App, key: event::KeyEvent) {
    match key.code {
        KeyCode::Esc => app.go_back(),
        KeyCode::Up => app.tracking_up(),
        KeyCode::Down => app.tracking_down(),
        KeyCode::Char('r') | KeyCode::Char('R') => app.refresh_tracking(),
        KeyCode::Char('q') | KeyCode::Char('Q') => app.should_quit = true,
        _ => {}
    }
}

/// Handle mouse/touch input
fn handle_mouse(app: &mut App, mouse: event::MouseEvent) {
    match mouse.kind {
        MouseEventKind::Down(MouseButton::Left) => {
            let x = mouse.column;
            let y = mouse.row;
            handle_click(app, x, y);
        }
        MouseEventKind::ScrollUp => {
            match app.screen {
                Screen::StationPicker(_) => app.picker_up(),
                Screen::TrainSelect => app.search_up(),
                Screen::Tracking => app.tracking_up(),
                _ => {}
            }
        }
        MouseEventKind::ScrollDown => {
            match app.screen {
                Screen::StationPicker(_) => app.picker_down(),
                Screen::TrainSelect => app.search_down(),
                Screen::Tracking => app.tracking_down(),
                _ => {}
            }
        }
        _ => {}
    }
}

/// Handle click/tap at a specific position
fn handle_click(app: &mut App, _x: u16, y: u16) {
    match &app.screen {
        Screen::Home => {
            // FROM box is roughly rows 3-7, TO box is also rows 3-7
            // Title is rows 0-2
            if y >= 3 && y <= 7 {
                // Check if left half or right half
                // We'll use a simple heuristic — the exact boundaries depend on
                // terminal width, but FROM is left half, TO is right half
                // For simplicity, both open FROM picker first time, TO second
                if app.from_code.is_empty() {
                    app.open_picker(PickerField::From);
                } else if app.to_code.is_empty() {
                    app.open_picker(PickerField::To);
                } else {
                    // Both set — search
                    app.search_trains();
                }
            }
        }
        Screen::StationPicker(_) => {
            // Station list starts at row 6 (header=3 + search=3)
            // Each station is 1 line
            if y >= 6 {
                let list_index = (y as usize).saturating_sub(7); // subtract header+search+border
                let actual_index = list_index + app.picker_scroll;
                if actual_index < app.picker_results.len() {
                    app.picker_selected = actual_index;
                    app.select_station();
                }
            }
        }
        Screen::TrainSelect => {
            // Train list starts at row 3
            if y >= 4 {
                let lines_per_item = 3;
                let item_index = ((y as usize).saturating_sub(4)) / lines_per_item;
                let actual_index = item_index + app.search_scroll;
                if actual_index < app.search_results.len() {
                    app.search_selected = actual_index;
                    let train_no = app.search_results[actual_index].train_no.clone();
                    app.track_train(&train_no);
                }
            }
        }
        Screen::Tracking => {
            // Just scroll on tap in tracking view
        }
    }
}
