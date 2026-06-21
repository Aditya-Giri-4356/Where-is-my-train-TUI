use crate::api::client::RailClient;
use crate::api::types::*;
use crate::utils;
use crate::db::DbClient;
/// Which field the station picker is selecting for
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PickerField {
    From,
    To,
}

/// Application screen states
#[derive(Debug, Clone, PartialEq)]
pub enum Screen {
    Home,
    StationPicker(PickerField),
    TrainSelect,
    Tracking,
}

/// The main application state
pub struct App {
    pub screen: Screen,
    pub should_quit: bool,

    // Station inputs
    pub from_code: String,
    pub from_name: String,
    pub to_code: String,
    pub to_name: String,

    // Station picker state
    pub picker_search: String,
    pub picker_results: Vec<(String, String)>, // (code, name)
    pub picker_selected: usize,
    pub picker_scroll: usize,

    // Train search results
    pub search_results: Vec<SearchTrainItem>,
    pub search_selected: usize,
    pub search_scroll: usize,
    pub search_loading: bool,
    pub search_error: Option<String>,

    // Tracking state
    pub tracking_data: Option<TrackTrainData>,
    pub tracking_train_no: String,
    pub tracking_loading: bool,
    pub tracking_error: Option<String>,
    pub tracking_scroll: usize,

    // Status
    pub status_msg: String,
    pub bridge_ok: bool,

    // API client and local DB
    pub client: RailClient,
    pub db: DbClient,
}

impl App {
    pub fn new() -> Self {
        let client = RailClient::new();
        let db = DbClient::new().unwrap_or_else(|e| panic!("Failed to initialize local database: {}", e));

        // Check bridge health
        let bridge_ok = client.health_check().map(|h| h.success).unwrap_or(false);

        let status_msg = if bridge_ok {
            "Bridge connected ✓".to_string()
        } else {
            "⚠ Bridge not running — start with: cd bridge && npm start".to_string()
        };

        let mut app = Self {
            screen: Screen::Home,
            should_quit: false,
            from_code: String::new(),
            from_name: String::new(),
            to_code: String::new(),
            to_name: String::new(),
            picker_search: String::new(),
            picker_results: Vec::new(),
            picker_selected: 0,
            picker_scroll: 0,
            search_results: Vec::new(),
            search_selected: 0,
            search_scroll: 0,
            search_loading: false,
            search_error: None,
            tracking_data: None,
            tracking_train_no: String::new(),
            tracking_loading: false,
            tracking_error: None,
            tracking_scroll: 0,
            status_msg,
            bridge_ok,
            client,
            db,
        };

        // Initialize picker with popular stations
        app.update_picker_results();
        app
    }

    /// Open the station picker for a specific field
    pub fn open_picker(&mut self, field: PickerField) {
        self.screen = Screen::StationPicker(field);
        self.picker_search.clear();
        self.picker_selected = 0;
        self.picker_scroll = 0;
        self.update_picker_results();
    }

    /// Update picker results based on search query
    pub fn update_picker_results(&mut self) {
        let query = self.picker_search.trim();
        if query.is_empty() {
            // Default stations when search is empty
            self.picker_results = vec![
                ("NDLS".to_string(), "NEW DELHI".to_string()),
                ("MAS".to_string(), "MGR CHENNAI CTL".to_string()),
                ("CSTM".to_string(), "CSMT MUMBAI".to_string()),
                ("HWH".to_string(), "HOWRAH JN".to_string()),
                ("TPJ".to_string(), "TIRUCHCHIRAPPALLI JN (TRICHY)".to_string()),
                ("TJ".to_string(), "THANJAVUR JN (TANJORE)".to_string()),
            ];
        } else {
            match self.db.search_stations(query) {
                Ok(stations) => {
                    self.picker_results = stations.into_iter()
                        .map(|st| (st.code, st.name))
                        .collect();
                    
                    // Allow custom code fallback if less than 6 chars
                    if self.picker_results.is_empty() && query.len() <= 6 {
                        self.picker_results.push((query.to_uppercase(), format!("{} (Custom)", query.to_uppercase())));
                    }
                }
                Err(_) => self.picker_results.clear(),
            }
        }

        // Reset selection if out of bounds
        if self.picker_selected >= self.picker_results.len() {
            self.picker_selected = 0;
        }
        if self.picker_scroll > self.picker_selected {
            self.picker_scroll = self.picker_selected;
        }
    }

    /// Select a station from the picker
    pub fn select_station(&mut self) {
        if let Some((code, name)) = self.picker_results.get(self.picker_selected).cloned() {
            match self.screen {
                Screen::StationPicker(PickerField::From) => {
                    self.from_code = code;
                    self.from_name = name;
                }
                Screen::StationPicker(PickerField::To) => {
                    self.to_code = code;
                    self.to_name = name;
                }
                _ => {}
            }
            self.screen = Screen::Home;
        }
    }

    /// Search trains between selected stations
    pub fn search_trains(&mut self) {
        if self.from_code.is_empty() || self.to_code.is_empty() {
            self.status_msg = "Select both FROM and TO stations first".to_string();
            return;
        }

        self.search_loading = true;
        self.search_error = None;
        self.status_msg = format!("Searching offline database {} → {}...", self.from_code, self.to_code);

        match self.db.get_trains_between_stations(&self.from_code, &self.to_code) {
            Ok(results) => {
                if results.is_empty() {
                    self.search_error = Some("No direct trains found in offline database".to_string());
                }
                
                // Map db TrainRouteResult to API SearchTrainItem for the UI
                self.search_results = results.into_iter().map(|t| SearchTrainItem {
                    train_no: t.train_number,
                    train_name: t.train_name,
                    from_stn_code: Some(self.from_code.clone()),
                    to_stn_code: Some(self.to_code.clone()),
                    from_stn_name: None,
                    to_stn_name: None,
                    from_time: Some(t.departure_time),
                    to_time: Some(t.arrival_time),
                    travel_time: Some(t.duration),
                    running_days: None,
                    distance: None,
                }).collect();
                
                self.search_selected = 0;
                self.search_scroll = 0;
                self.screen = Screen::TrainSelect;
                self.status_msg = format!("Found {} trains offline", self.search_results.len());
            }
            Err(e) => {
                self.search_error = Some(e.to_string());
                self.status_msg = format!("DB Error: {}", e);
            }
        }
        self.search_loading = false;
    }

    /// Track a specific train
    pub fn track_train(&mut self, train_no: &str) {
        self.tracking_train_no = train_no.to_string();
        self.tracking_loading = true;
        self.tracking_error = None;
        self.tracking_scroll = 0;
        self.status_msg = format!("Tracking train {}...", train_no);

        let date = utils::today_ddmmyyyy();
        match self.client.track_train(train_no, Some(&date)) {
            Ok(resp) => {
                if let Some(data) = resp.data {
                    self.tracking_data = Some(data);
                    self.screen = Screen::Tracking;
                    self.status_msg = "Live tracking active".to_string();
                } else {
                    self.tracking_error = resp.error.or(Some("No tracking data available".to_string()));
                    self.status_msg = "Tracking failed".to_string();
                    self.screen = Screen::Tracking;
                }
            }
            Err(e) => {
                self.tracking_error = Some(e.to_string());
                self.status_msg = format!("Error: {}", e);
                self.screen = Screen::Tracking;
            }
        }
        self.tracking_loading = false;
    }

    /// Refresh tracking data
    pub fn refresh_tracking(&mut self) {
        if self.tracking_train_no.is_empty() {
            return;
        }
        let train_no = self.tracking_train_no.clone();
        self.track_train(&train_no);
    }

    /// Navigate back
    pub fn go_back(&mut self) {
        match self.screen {
            Screen::StationPicker(_) => self.screen = Screen::Home,
            Screen::TrainSelect => self.screen = Screen::Home,
            Screen::Tracking => self.screen = Screen::TrainSelect,
            Screen::Home => self.should_quit = true,
        }
    }

    /// Picker: move selection up
    pub fn picker_up(&mut self) {
        if self.picker_selected > 0 {
            self.picker_selected -= 1;
        }
    }

    /// Picker: move selection down
    pub fn picker_down(&mut self) {
        if self.picker_selected + 1 < self.picker_results.len() {
            self.picker_selected += 1;
        }
    }

    /// Search results: move selection up
    pub fn search_up(&mut self) {
        if self.search_selected > 0 {
            self.search_selected -= 1;
        }
    }

    /// Search results: move selection down
    pub fn search_down(&mut self) {
        if self.search_selected + 1 < self.search_results.len() {
            self.search_selected += 1;
        }
    }

    /// Tracking: scroll up
    pub fn tracking_up(&mut self) {
        if self.tracking_scroll > 0 {
            self.tracking_scroll -= 1;
        }
    }

    /// Tracking: scroll down
    pub fn tracking_down(&mut self) {
        self.tracking_scroll += 1;
    }
}
