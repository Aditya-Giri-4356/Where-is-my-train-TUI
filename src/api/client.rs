use super::types::*;
use std::fmt;
use std::time::Duration;

const BRIDGE_URL: &str = "http://127.0.0.1:3456";
const TIMEOUT_SECS: u64 = 30;

#[derive(Debug)]
pub enum ApiError {
    Network(String),
    Parse(String),
    Server(String),
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::Network(e) => write!(f, "Network error: {}", e),
            ApiError::Parse(e) => write!(f, "Parse error: {}", e),
            ApiError::Server(e) => write!(f, "Server error: {}", e),
        }
    }
}

pub struct RailClient {
    client: reqwest::blocking::Client,
    base_url: String,
}

impl RailClient {
    pub fn new() -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(TIMEOUT_SECS))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            base_url: BRIDGE_URL.to_string(),
        }
    }

    /// Check if the bridge server is running and configured
    pub fn health_check(&self) -> Result<HealthResponse, ApiError> {
        let url = format!("{}/api/health", self.base_url);
        let resp = self
            .client
            .get(&url)
            .send()
            .map_err(|e| ApiError::Network(e.to_string()))?;

        resp.json::<HealthResponse>()
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Track a train's live status
    pub fn track_train(
        &self,
        train_no: &str,
        date: Option<&str>,
    ) -> Result<TrackTrainResponse, ApiError> {
        let url = match date {
            Some(d) => format!("{}/api/track/{}/{}", self.base_url, train_no, d),
            None => format!("{}/api/track/{}", self.base_url, train_no),
        };

        let resp = self
            .client
            .get(&url)
            .send()
            .map_err(|e| ApiError::Network(e.to_string()))?;

        let data: TrackTrainResponse = resp
            .json()
            .map_err(|e| ApiError::Parse(e.to_string()))?;

        if !data.success {
            if let Some(ref err) = data.error {
                return Err(ApiError::Server(err.clone()));
            }
        }

        Ok(data)
    }

    /// Get train information and full route
    pub fn get_train_info(&self, train_no: &str) -> Result<TrainInfoResponse, ApiError> {
        let url = format!("{}/api/train/{}", self.base_url, train_no);

        let resp = self
            .client
            .get(&url)
            .send()
            .map_err(|e| ApiError::Network(e.to_string()))?;

        let data: TrainInfoResponse = resp
            .json()
            .map_err(|e| ApiError::Parse(e.to_string()))?;

        if !data.success {
            if let Some(ref err) = data.error {
                return Err(ApiError::Server(err.clone()));
            }
        }

        Ok(data)
    }

    /// Search for trains between two stations
    pub fn search_trains(
        &self,
        from: &str,
        to: &str,
    ) -> Result<SearchTrainsResponse, ApiError> {
        let url = format!("{}/api/search/{}/{}", self.base_url, from, to);

        let resp = self
            .client
            .get(&url)
            .send()
            .map_err(|e| ApiError::Network(e.to_string()))?;

        let data: SearchTrainsResponse = resp
            .json()
            .map_err(|e| ApiError::Parse(e.to_string()))?;

        if !data.success {
            if let Some(ref err) = data.error {
                return Err(ApiError::Server(err.clone()));
            }
        }

        Ok(data)
    }
}
