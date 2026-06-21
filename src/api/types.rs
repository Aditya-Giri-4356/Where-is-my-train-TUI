use serde::Deserialize;

// ─── Track Train Response ───────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct TrackTrainResponse {
    pub success: bool,
    pub data: Option<TrackTrainData>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TrackTrainData {
    pub train_name: String,
    pub current_station: Option<String>,
    pub current_delay: Option<String>,
    pub stations: Vec<TrackStation>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TrackStation {
    pub station_name: String,
    pub station_code: String,
    pub scheduled_arrival: String,
    pub scheduled_departure: String,
    pub actual_arrival: String,
    pub actual_departure: String,
    pub delay_minutes: Option<i32>,
    pub is_stopping: bool,
    pub status: String,
}

// ─── Train Info Response ────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct TrainInfoResponse {
    pub success: bool,
    pub data: Option<TrainInfoData>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainInfoData {
    pub train_info: TrainDetails,
    pub route: Vec<RouteStation>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TrainDetails {
    pub train_no: String,
    pub train_name: String,
    pub from_stn_name: Option<String>,
    pub from_stn_code: Option<String>,
    pub to_stn_name: Option<String>,
    pub to_stn_code: Option<String>,
    pub from_time: Option<String>,
    pub to_time: Option<String>,
    pub travel_time: Option<String>,
    pub running_days: Option<String>,
    #[serde(rename = "type")]
    pub train_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteStation {
    pub stn_code: String,
    pub stn_name: String,
    pub arrival: Option<String>,
    pub departure: Option<String>,
    pub halt: Option<String>,
    pub distance: Option<String>,
    pub day: Option<String>,
}

// ─── Search Trains Response ─────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct SearchTrainsResponse {
    pub success: bool,
    pub data: Option<Vec<SearchTrainItem>>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchTrainItem {
    pub train_no: String,
    pub train_name: String,
    pub from_stn_name: Option<String>,
    pub from_stn_code: Option<String>,
    pub to_stn_name: Option<String>,
    pub to_stn_code: Option<String>,
    pub from_time: Option<String>,
    pub to_time: Option<String>,
    pub travel_time: Option<String>,
    pub running_days: Option<String>,
    pub distance: Option<String>,
}

// ─── Health Response ────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct HealthResponse {
    pub success: bool,
    pub configured: bool,
}
