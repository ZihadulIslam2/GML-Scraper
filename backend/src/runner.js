// Orchestrates a full scrape job: Google Maps extraction + optional
// website email enrichment + CSV/JSON persistence.

const { scrapeBusinesses } = require('./scraper');
const { enrichWithEmails } = require('./emailScraper');
const { saveCsv, saveJson } = require('./csvExport');

async function runScrape(job, { onProgress } = {}) {
  const { keyword, location, maxResults, scrapeEmails = true, pagesPerSite = 3, concurrency = 4 } = job.params;

  const report = (patch) => {
    if (onProgress) onProgress(patch);
  };

  report({ stage: 'maps', text: 'Searching Google Maps…' });
  const mapsResult = await scrapeBusinesses({
    keyword,
    location,
    maxResults,
    headless: true,
    enrichDetails: true,
    onProgress: (p) => {
      let text = p.text;
      if (!text) {
        if (p.stage === 'scrolling') {
          text = `Scrolling Google Maps (${p.found || 0}/${p.total} loaded)…`;
        } else if (p.stage === 'extracting') {
          text = `Extracting listings (${p.found || 0}/${p.total})…`;
        } else if (p.stage === 'enriching') {
          text = `Fetching websites & phone numbers (${p.found || 0}/${p.total})…`;
        }
      }
      report({ ...p, text });
    },
  });

  let businesses = mapsResult.businesses.map((b, i) => ({ ...b, _index: i }));

  if (scrapeEmails) {
    report({ stage: 'emails', text: `Enriching ${businesses.length} websites with emails…` });
    businesses = await enrichWithEmails(businesses, { concurrency, pagesPerSite });
    report({ stage: 'emails', text: 'Email enrichment complete.' });
  }

  businesses.forEach((b) => delete b._index);

  const meta = { keyword, location, maxResults: mapsResult.requested, scrapedCount: businesses.length };

  const jsonFile = saveJson(businesses, meta);
  const csvFile = await saveCsv(businesses, meta);

  return {
    meta: {
      keyword,
      location,
      requested: mapsResult.requested,
      scraped: businesses.length,
      durationMs: mapsResult.durationMs,
    },
    outputFiles: { json: jsonFile, csv: csvFile },
    businesses,
  };
}

module.exports = { runScrape };
