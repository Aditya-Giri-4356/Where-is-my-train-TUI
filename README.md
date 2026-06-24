# Where Is My Train TUI

Where Is My Train TUI is a terminal-based clone of the popular Indian Railways application. It allows you to search for stations, find direct routes between stations (including local and passenger trains), and track live train status directly from your terminal.

## Architecture and Development Process

Building this application required navigating significant challenges regarding the availability of public railway data in India. The development process went through several iterations to reach a stable, fast, and free architecture.

### Iteration 1: The Search for a Reliable API
Initially, the goal was to rely entirely on public APIs (such as RailKit, erail, or ConfirmTkt) to search for stations, resolve routes, and track live statuses. However, we quickly discovered that most free or unofficial APIs are either deprecated, severely rate-limited, block access via CORS/IP restrictions, or simply do not provide data for local passenger trains. Finding an open-source, fully legal, and unrestricted API that met all requirements was impossible.

### Iteration 2: Puppeteer Scraping
To solve the live tracking issue, the second iteration involved building a Node.js bridge server that used Puppeteer. This server ran a headless browser to actively scrape the National Train Enquiry System (NTES). While this worked for a time, it proved fragile. Heavy DOM reliance meant that if a train was inactive or NTES slightly changed its layout, the scraper would time out or crash, which in turn locked up the terminal application. It was also slow and resource-heavy.

### Iteration 3: The Hybrid Offline-First Approach (Final)
To achieve zero-latency searches and ensure absolute reliability, the architecture was split into a hybrid model:

1. **Offline Database for Routes and Stations**:
   We shifted all station and route lookups to an offline SQLite database. A script was written to download comprehensive Datameet JSON datasets (representing approximately 8,900 stations, 5,200 trains, and 417,000 route stops) and convert them into `railway.db`. The Rust backend uses `rusqlite` and `fuzzy-matcher` to provide instantaneous, zero-latency searches. This solved the issue of missing local trains permanently.

2. **IndianRailAPI for Live Tracking**:
   The fragile Puppeteer scraper was replaced with a direct fetch call to the `indianrailapi.com` v2 endpoint. The Node.js bridge now acts purely as a lightweight proxy/cache that forwards requests to this API. This eliminated headless browser overhead and made error handling robust.

## Features

- **Offline Station Search**: Fuzzy matching for over 8,900 Indian Railway stations.
- **Offline Route Resolution**: Instantly finds trains running between any two stations using a sequence-aware SQLite subquery.
- **Live Status Tracking**: Fetches real-time status (current location, delays, upcoming stations) via a lightweight Node.js proxy.
- **Keyboard and Mouse Support**: Navigate the interface using arrow keys, or click/tap directly on the terminal elements.
- **Reference UI Match**: The train list replicates the clean, organized style of the original mobile application.

## Requirements

- Rust (cargo)
- Node.js (for the proxy server)

## How to Run

First, install the bridge server dependencies:
```bash
cd bridge
npm install
cd ..
```

Then, run the Rust application:
```bash
cargo run
```

The application will automatically spawn the Node.js background server on port 3456 and launch the terminal user interface.

## Running on Mobile

The mobile bridge (`server.mobile.js`) uses **zero npm dependencies** — only Node.js built-in modules. No `npm install` required.

### iSH (iPhone/iPad — Alpine Linux)
```sh
git clone https://github.com/Aditya-Giri-4356/Where-is-my-train-TUI
cd Where-is-my-train-TUI
sh scripts/setup-alpine.sh    # installs nodejs, git, curl via apk

# Then every time:
node bridge/server.mobile.js &
node mobile-tui.js
```

### Termux (Android)
```sh
git clone https://github.com/Aditya-Giri-4356/Where-is-my-train-TUI
cd Where-is-my-train-TUI
sh scripts/setup-termux.sh    # installs nodejs, git, curl via pkg

# Then every time:
node bridge/server.mobile.js &
node mobile-tui.js
```

> **No `npm install` needed on mobile.** The mobile bridge and mobile TUI have zero dependencies.
> Offline station search and train routes work identically on all platforms.
> Live tracking uses NTES direct HTTP fetch (no Chromium/Puppeteer required).
