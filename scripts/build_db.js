const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, '..', 'railway.db');

const URLS = {
  stations: 'https://raw.githubusercontent.com/datameet/railways/master/stations.json',
  trains: 'https://raw.githubusercontent.com/datameet/railways/master/trains.json',
  schedules: 'https://raw.githubusercontent.com/datameet/railways/master/schedules.json'
};

async function downloadFile(url, dest) {
  console.log(`Downloading ${url}...`);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });

  const writer = fs.createWriteStream(dest);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function buildDatabase() {
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }

  const db = new sqlite3.Database(DB_PATH);

  // Setup schema
  db.serialize(() => {
    db.run(`CREATE TABLE stations (
      code TEXT PRIMARY KEY,
      name TEXT,
      zone TEXT,
      state TEXT,
      address TEXT,
      lat REAL,
      lng REAL
    )`);

    db.run(`CREATE TABLE trains (
      number TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      zone TEXT,
      from_station_code TEXT,
      to_station_code TEXT,
      duration_h INTEGER,
      duration_m INTEGER,
      distance INTEGER
    )`);

    db.run(`CREATE TABLE routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      train_number TEXT,
      station_code TEXT,
      station_name TEXT,
      day INTEGER,
      arrival TEXT,
      departure TEXT,
      distance INTEGER,
      FOREIGN KEY(train_number) REFERENCES trains(number),
      FOREIGN KEY(station_code) REFERENCES stations(code)
    )`);

    db.run(`CREATE INDEX idx_routes_train ON routes(train_number)`);
    db.run(`CREATE INDEX idx_routes_station ON routes(station_code)`);
  });

  console.log('Database schema created.');

  // Download and insert stations
  await downloadFile(URLS.stations, 'stations.json');
  console.log('Parsing stations...');
  const stationsData = JSON.parse(fs.readFileSync('stations.json', 'utf8'));
  const insertStation = db.prepare('INSERT OR IGNORE INTO stations VALUES (?, ?, ?, ?, ?, ?, ?)');
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    for (const feature of stationsData.features) {
      const p = feature.properties;
      const coords = feature.geometry ? feature.geometry.coordinates : [null, null];
      insertStation.run(p.code, p.name, p.zone, p.state, p.address, coords[1], coords[0]);
    }
    db.run('COMMIT');
  });
  insertStation.finalize();
  console.log(`Inserted ${stationsData.features.length} stations.`);

  // Download and insert trains
  await downloadFile(URLS.trains, 'trains.json');
  console.log('Parsing trains...');
  const trainsData = JSON.parse(fs.readFileSync('trains.json', 'utf8'));
  const insertTrain = db.prepare('INSERT OR IGNORE INTO trains VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    for (const feature of trainsData.features) {
      const p = feature.properties;
      insertTrain.run(p.number, p.name, p.type, p.zone, p.from_station_code, p.to_station_code, p.duration_h, p.duration_m, p.distance);
    }
    db.run('COMMIT');
  });
  insertTrain.finalize();
  console.log(`Inserted ${trainsData.features.length} trains.`);

  // Download and insert schedules (routes)
  await downloadFile(URLS.schedules, 'schedules.json');
  console.log('Parsing schedules... this might take a moment');
  // schedules.json is massive. We should parse it carefully.
  const schedulesData = JSON.parse(fs.readFileSync('schedules.json', 'utf8'));
  const insertRoute = db.prepare('INSERT INTO routes (train_number, station_code, station_name, day, arrival, departure, distance) VALUES (?, ?, ?, ?, ?, ?, ?)');

  // It's a huge array of objects or an array of features? 
  // Wait, let's check its structure. Usually it's an array of objects for schedules.
  const records = Array.isArray(schedulesData) ? schedulesData : (schedulesData.features ? schedulesData.features.map(f => f.properties) : []);
  
  console.log(`Found ${records.length} route records.`);

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    let count = 0;
    for (const p of records) {
      // p might have properties like train_number, station_code, day, arrival, departure, distance
      const trainNo = p.train_number || p.train_No || p.number || p.train_no;
      const stnCode = p.station_code || p.station_Code || p.code;
      const stnName = p.station_name || p.station_Name || p.name;
      insertRoute.run(trainNo, stnCode, stnName, p.day, p.arrival, p.departure, p.distance);
      count++;
    }
    db.run('COMMIT');
    console.log(`Inserted ${count} route stops.`);
  });
  insertRoute.finalize();

  db.close(() => {
    console.log('Database built successfully at', DB_PATH);
    // Cleanup JSON files
    fs.unlinkSync('stations.json');
    fs.unlinkSync('trains.json');
    fs.unlinkSync('schedules.json');
  });
}

buildDatabase().catch(console.error);
