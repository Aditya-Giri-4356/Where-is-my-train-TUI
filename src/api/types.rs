use serde::Deserialize;

// ─── Track Train Response ───────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct TrackTrainResponse {
    pub success: bool,
    pub data: Option<TrackTrainData>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackTrainData {
    pub train_no: String,
    pub train_name: String,
    pub date: Option<String>,
    pub status_note: Option<String>,
    pub last_update: Option<String>,
    pub total_stations: Option<u32>,
    pub current_station_code: Option<String>,
    pub timeline: Vec<TimelinePoint>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePoint {
    #[serde(rename = "type")]
    pub point_type: String, // "stoppage" | "intermediate"
    pub status: String, // "passed" | "current" | "upcoming"
    pub station_code: String,
    pub station_name: String,
    pub platform: Option<String>,
    pub distance_km: Option<String>,
    pub arrival: Option<ArrivalDeparture>,
    pub departure: Option<ArrivalDeparture>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ArrivalDeparture {
    pub scheduled: Option<String>,
    pub actual: Option<String>,
    pub delay: Option<String>,
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
