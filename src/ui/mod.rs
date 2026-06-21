pub mod home;
pub mod station_picker;
pub mod widgets;

use crate::app::{App, Screen};
use ratatui::Frame;

/// Main render dispatcher
pub fn draw(f: &mut Frame, app: &App) {
    match &app.screen {
        Screen::Home => home::draw_home(f, app),
        Screen::StationPicker(_) => station_picker::draw_station_picker(f, app),
        Screen::TrainSelect => home::draw_train_select(f, app),
        Screen::Tracking => home::draw_tracking(f, app),
    }
}
