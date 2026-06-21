use rusqlite::{Connection, Result, params};
use fuzzy_matcher::FuzzyMatcher;
use fuzzy_matcher::skim::SkimMatcherV2;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct Station {
    pub code: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct TrainRouteResult {
    pub train_number: String,
    pub train_name: String,
    pub departure_time: String,
    pub arrival_time: String,
    pub duration: String,
}

pub struct DbClient {
    conn: Connection,
    matcher: SkimMatcherV2,
}

impl DbClient {
    pub fn new() -> Result<Self> {
        // Look for the database in the root folder or executable directory
        let db_path = Path::new("railway.db");
        let conn = Connection::open(db_path)?;
        
        Ok(Self {
            conn,
            matcher: SkimMatcherV2::default(),
        })
    }

    pub fn search_stations(&self, query: &str) -> Result<Vec<Station>> {
        let mut stmt = self.conn.prepare("SELECT code, name FROM stations")?;
        let station_iter = stmt.query_map([], |row| {
            Ok(Station {
                code: row.get(0)?,
                name: row.get(1)?,
            })
        })?;

        let mut scored: Vec<(i64, Station)> = Vec::new();
        for st in station_iter {
            if let Ok(st) = st {
                // If the query exactly matches the code, prioritize it heavily
                if query.eq_ignore_ascii_case(&st.code) {
                    return Ok(vec![st]);
                }
                
                // Add aliases logic
                let mut search_target = st.name.clone();
                if st.code == "TPJ" || st.code == "TPJN" {
                    search_target.push_str(" TRICHY TIRUCHIRAPPALLI");
                } else if st.code == "TJ" {
                    search_target.push_str(" TANJORE THANJAVUR");
                }

                if let Some(score) = self.matcher.fuzzy_match(&search_target, query) {
                    if score > 20 { // Threshold for decent matches
                        scored.push((score, st));
                    }
                }
            }
        }

        scored.sort_by(|a, b| b.0.cmp(&a.0));  // highest score first
        Ok(scored.into_iter().take(15).map(|(_, s)| s).collect())
    }

    pub fn get_trains_between_stations(&self, from: &str, to: &str) -> Result<Vec<TrainRouteResult>> {
        let query = r#"
            SELECT DISTINCT 
                t.number, 
                t.name, 
                r1.departure, 
                r2.arrival 
            FROM trains t
            JOIN routes r1 ON t.number = r1.train_number AND r1.station_code = ?1
            JOIN routes r2 ON t.number = r2.train_number AND r2.station_code = ?2
            WHERE r1.id < r2.id
            ORDER BY r1.departure ASC
        "#;

        let mut stmt = self.conn.prepare(query)?;
        let train_iter = stmt.query_map(params![from, to], |row| {
            let train_number: String = row.get(0)?;
            let train_name: String = row.get(1)?;
            let departure_time: String = row.get(2)?;
            let arrival_time: String = row.get(3)?;

            Ok(TrainRouteResult {
                train_number,
                train_name,
                departure_time: departure_time.clone(),
                arrival_time: arrival_time.clone(),
                duration: compute_duration(&departure_time, &arrival_time),
            })
        })?;

        let mut results = Vec::new();
        for t in train_iter {
            if let Ok(t) = t {
                results.push(t);
            }
        }

        Ok(results)
    }
}

fn compute_duration(dep: &str, arr: &str) -> String {
    let parse = |t: &str| -> Option<i32> {
        let parts: Vec<&str> = t.splitn(2, ':').collect();
        if parts.len() < 2 { return None; }
        let h: i32 = parts[0].parse().ok()?;
        let m: i32 = parts[1][..2.min(parts[1].len())].parse().ok()?;
        Some(h * 60 + m)
    };
    if let (Some(d), Some(a)) = (parse(dep), parse(arr)) {
        let diff = if a >= d { a - d } else { a + 1440 - d }; // handle midnight crossover
        format!("{} hr {} min", diff / 60, diff % 60)
    } else {
        "N/A".to_string()
    }
}
