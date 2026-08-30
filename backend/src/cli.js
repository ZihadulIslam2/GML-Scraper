#!/usr/bin/env node
// Standalone CLI: run a Google Maps lead scrape from the terminal.
//
//   node src/cli.js "Dentist" "Dallas, Texas" 100
//   node src/cli.js "Dentist" "Dallas, Texas" 100 --no-emails
//   node src/cli.js "Dentist" "Dallas, Texas" 100 --concurrency 4 --pages 3

const { createJob, updateJob } = require('./jobStore');
const { runScrape } = require('./runner');

function parseArgs(argv) {
  const [keyword = null, location = null, maxResults = 100] = argv;
  const flags = argv.slice(3);
  const opts = {
    scrapeEmails: !flags.includes('--no-emails'),
    concurrency: 4,
    pagesPerSite: 3,
  };
  for (const f of flags) {
    if (f.startsWith('--concurrency=')) opts.concurrency = parseInt(f.split('=')[1], 10);
    if (f.startsWith('--pages=')) opts.pagesPerSite = parseInt(f.split('=')[1], 10);
  }
  return { keyword, location, maxResults: parseInt(maxResults, 10), ...opts };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.keyword || !args.location) {
    console.error('Usage: node src/cli.js "<keyword>" "<location>" [maxResults] [--no-emails] [--concurrency=N] [--pages=N]');
    process.exit(1);
  }

  const job = createJob(args);
  const id = job.id;
  console.log(`Job ${id} started: "${args.keyword}" in "${args.location}" (max ${args.maxResults})`);

  const t0 = Date.now();
  const result = await runScrape(job, {
    onProgress: (p) => {
      updateJob(id, { progress: p });
      if (p.text) process.stdout.write(`\r${p.text}`);
      else process.stdout.write(`\r${p.stage}: ${p.found || 0}/${p.total || '?'}`);
    },
  });

  console.log('\n\nDone in', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log(`Scraped ${result.meta.scraped} businesses`);
  console.log(`JSON: ${result.outputFiles.json}`);
  console.log(`CSV:  ${result.outputFiles.csv}`);

  const withEmail = result.businesses.filter((b) => b.email).length;
  console.log(`Emails found: ${withEmail}/${result.businesses.length}`);
}

main().catch((err) => {
  console.error('\nError:', err);
  process.exit(1);
});
