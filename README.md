# 🗺️ Google Maps Lead Scraper

A full-stack Node.js lead-generation tool that scrapes business listings from Google Maps using Playwright, enriches each result by visiting the business website to find publicly listed emails/contact pages, and exports everything to CSV.

## Features

- **Google Maps scraping** — search by keyword + location, scrolls results to your target count
- **Extracted fields**
  - Business name, category, address, phone, website, Google Maps URL
  - Rating, review count, business hours
  - Email & contact page (via second-stage website scraper)
- **Email enrichment** — visits each business website, finds `mailto:` links and raw email addresses on the homepage + likely contact pages
- **CSV + JSON export** — results saved to `scraped-output/`
- **Web UI** — Next.js dashboard shows live progress and a results table
- **REST API** — `POST /api/scrape`, `GET /api/jobs/:id`, download CSV
- **CLI** — run a scrape entirely from the terminal

## Architecture

```
Web UI (Next.js)
   ↓ HTTP
Node.js API (Express) ──┐
   ↓                     │ in-memory job store
Playwright automation    │
   ↓                     ▼
Google Maps  →  extract businesses (name/address/phone/rating/hours/…)
   ↓
Second-stage website scraper  →  emails + contact page
   ↓
CSV / JSON export  →  scraped-output/
```

## Prerequisites

- Node.js **20+**
- npm

## Setup

```bash
# 1. Install all dependencies (root + backend + frontend)
npm install
npm run install:all

# 2. Install the Playwright Chromium browser
npm run setup:browser
```

## Run

### Option A — Web UI + API (recommended)

```bash
npm run dev
```

- Backend API: http://localhost:4000
- Web UI: http://localhost:3000

Open the web UI, enter a keyword (e.g. `Dentist`), a location (e.g. `Dallas, Texas`), pick a max result count, and hit **Start Scraping**.

### Option B — CLI only

```bash
cd backend
node src/cli.js "Dentist" "Dallas, Texas" 100
```

Options:
- `--no-emails` — skip the website email enrichment stage (much faster)
- `--concurrency=N` — how many websites to visit in parallel (default 4)
- `--pages=N` — how many pages per website to visit (default 3)

### Option C — API only

```bash
cd backend
npm start
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/scrape` | Start a scrape job |
| `GET` | `/api/jobs` | List all jobs |
| `GET` | `/api/jobs/:id` | Get a job (status + results) |
| `GET` | `/api/jobs/:id/download/csv` | Download the job's CSV |

### `POST /api/scrape`

```json
{
  "keyword": "Dentist",
  "location": "Dallas, Texas",
  "maxResults": 100,
  "scrapeEmails": true,
  "pagesPerSite": 3,
  "concurrency": 4
}
```

Returns a `job` object with an `id`. Poll `GET /api/jobs/:id` — status transitions `queued → running → completed | failed`.

## Output

Every completed job writes two files to `scraped-output/`:

- `keyword-location-<timestamp>.csv`
- `keyword-location-<timestamp>.json`

CSV columns: `Keyword, Location, Business Name, Category, Address, Phone, Website, Google Maps URL, Rating, Review Count, Hours, Email, Emails, Contact Page`.

## Important notes / caveats

- **Directly scraping Google Maps can violate Google's Terms of Service** and may trigger anti-bot measures (CAPTCHAs, blocks). Use responsibly, at small scale, and consider the official **Google Places API** for production/at-scale use.
- The Maps DOM and embedded data blob change frequently; the scraper includes **fallback parsing** from visible text, but you may need to update selectors as Google changes its UI.
- Email enrichment only finds **publicly listed** emails — many sites don't expose them, so coverage varies.

## Project structure

```
gmapscraper/
├── backend/
│   └── src/
│       ├── server.js       # Express API
│       ├── scraper.js      # Playwright Google Maps scraper
│       ├── emailScraper.js # website email/contact extraction
│       ├── runner.js       # orchestrates a full job
│       ├── csvExport.js    # CSV + JSON export
│       ├── jobStore.js     # in-memory job store
│       └── cli.js          # CLI entrypoint
├── frontend/
│   └── src/app/
│       ├── page.js         # dashboard UI
│       └── layout.js
├── scrape-output/          # generated CSV/JSON (git-ignored)
└── package.json
```

## Customisation

- **Headless vs headed** — set `headless: false` in `scraper.js` to watch the browser work (helpful for debugging).
- **Selector updates** — if Google changes its UI, adjust `div[role="feed"] > div > div > a` and the `APP_INITIALIZATION_STATE` parsing in `scraper.js`.
- **Persistence** — `jobStore.js` is in-memory; swap for MongoDB/Redis if you need results to survive restarts.
# Google-Maps-Lead-Scraper
