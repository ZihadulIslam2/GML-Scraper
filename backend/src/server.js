// Express API server for the Google Maps lead scraper.

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const { createJob, updateJob, getJob, listJobs } = require('./jobStore');
const { runScrape } = require('./runner');

const app = express();
const PORT = process.env.PORT || 4000;
const MAX_ACTIVE_SCRAPES = parseInt(process.env.MAX_ACTIVE_SCRAPES, 10) || 2;

// Simple fixed-size semaphore to bound the number of chromium instances the
// server can spawn at once. Each scrapes launches a full headless browser, so
// unbounded concurrency easily OOMs a small VPS.
class Semaphore {
  constructor(size) {
    this.size = size;
    this.active = 0;
    this.waiters = [];
  }
  async acquire() {
    if (this.active < this.size) {
      this.active++;
      return;
    }
    await new Promise((resolve) => this.waiters.push(resolve));
    this.active++;
  }
  release() {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

const scrapeSemaphore = new Semaphore(MAX_ACTIVE_SCRAPES);
const scrapeThrottle = new Map(); // ip -> last start time (ms)

// Coarse per-IP throttle on /api/scrape to prevent one caller from hammering
// the endpoint. Configurable via THROTTLE_MS (default 10s).
function throttleScrape(ip) {
  const minGap = parseInt(process.env.THROTTLE_MS, 10) || 10000;
  const now = Date.now();
  const last = scrapeThrottle.get(ip) || 0;
  if (now - last < minGap) {
    return Math.ceil((minGap - (now - last)) / 1000);
  }
  scrapeThrottle.set(ip, now);
  return 0;
}

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/jobs', (_req, res) => {
  res.json({ jobs: listJobs() });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ job });
});

// Download latest CSV for a completed job.
app.get('/api/jobs/:id/download/csv', async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'completed' || !job.result?.outputFiles?.csv) {
    return res.status(400).json({ error: 'Job has no CSV yet' });
  }
  res.sendFile(path.resolve(job.result.outputFiles.csv), (err) => {
    if (err) {
      if (!res.headersSent) res.status(500).json({ error: 'CSV file unavailable' });
    }
  });
});

// Kick off a new scrape.
app.post('/api/scrape', async (req, res) => {
  const { keyword, location, maxResults = 100, scrapeEmails = true, pagesPerSite = 3, concurrency = 4 } =
    req.body || {};

  if (!keyword || !location) {
    return res.status(400).json({ error: 'keyword and location are required' });
  }

  const retryIn = throttleScrape(req.ip || req.socket?.remoteAddress || 'unknown');
  if (retryIn > 0) {
    return res.status(429).json({ error: 'Too many requests', retryInSeconds: retryIn });
  }

  const max = Math.min(Math.max(parseInt(maxResults, 10) || 0, 1), 500);
  const bizConcurrency = Math.min(Math.max(parseInt(concurrency, 10) || 4, 1), 8);

  const job = createJob({
    keyword: String(keyword),
    location: String(location),
    maxResults: max,
    scrapeEmails: !!scrapeEmails,
    pagesPerSite: parseInt(pagesPerSite, 10) || 3,
    concurrency: bizConcurrency,
  });

  res.status(202).json({ job });

  // run in background, bounded by the global semaphore
  scrapeSemaphore.acquire().then(() => {
    updateJob(job.id, { status: 'running' });
    return runScrape(job, {
      onProgress: (p) => {
        updateJob(job.id, { progress: p });
      },
    })
      .then(async (result) => {
        updateJob(job.id, { status: 'completed', result });
      })
      .catch((err) => {
        console.error('Scrape failed:', err);
        updateJob(job.id, { status: 'failed', error: String(err?.message || err) });
      })
      .finally(() => {
        scrapeSemaphore.release();
      });
  });
});

app.listen(PORT, () => {
  console.log(`Scraper API listening on http://localhost:${PORT}`);
});
