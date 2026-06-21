use chrono::Local;

/// Format today's date as DD-MM-YYYY for the RailKit API
pub fn today_ddmmyyyy() -> String {
    Local::now().format("%d-%m-%Y").to_string()
}


/// Truncate a string to fit within max_width, adding "…" if needed
pub fn truncate(s: &str, max_width: usize) -> String {
    if s.len() <= max_width {
        s.to_string()
    } else if max_width > 1 {
        format!("{}…", &s[..max_width - 1])
    } else {
        "…".to_string()
    }
}

/// Format a delay string with color hint
pub fn delay_label(delay_str: &str) -> (&'static str, &str) {
    let trimmed = delay_str.trim();
    if trimmed.is_empty() || trimmed == "On Time" || trimmed == "Right Time" {
        ("on_time", "ON TIME")
    } else if trimmed.starts_with('-') {
        ("early", "EARLY")
    } else {
        ("delayed", trimmed)
    }
}
