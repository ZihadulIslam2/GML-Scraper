// CSV export helpers and disk persistence for scraped results.

const { stringify } = require('csv-stringify');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'scraped-output');

const CSV_COLUMNS = [
  'Keyword',
  'Location',
  'Business Name',
  'Category',
  'Address',
  'Phone',
  'Website',
  'Google Maps URL',
  'Rating',
  'Review Count',
  'Hours',
  'Email',
  'Emails',
  'Contact Page',
];

function formatHours(hours) {
  if (!hours) return '';
  const entries = Array.isArray(hours) ? hours : [hours];
  return entries
    .map((h) => `${h.day || ''}: ${h.open || ''}-${h.close || ''}`)
    .filter(Boolean)
    .join('; ');
}

function toCsvRow(business, meta = {}) {
  const row = {
    'Keyword': meta.keyword || '',
    'Location': meta.location || '',
    'Business Name': business.title || '',
    'Category': business.category || '',
    'Address': business.address || '',
    'Phone': business.phone || '',
    'Website': business.website || '',
    'Google Maps URL': business.url || '',
    'Rating': business.rating || '',
    'Review Count': business.reviews || '',
    'Hours': formatHours(business.hours),
    'Email': business.email || '',
    'Emails': (business.emails || []).join('; '),
    'Contact Page': business.contactPage || '',
  };
  return row;
}

function buildCsv(businesses, meta = {}) {
  const rows = businesses.map((b) => toCsvRow(b, meta));
  return new Promise((resolve, reject) => {
    stringify(rows, { header: true, columns: CSV_COLUMNS }, (err, out) => {
      if (err) return reject(err);
      resolve(out);
    });
  });
}

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function saveJson(businesses, meta = {}) {
  ensureOutputDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${slugify(meta.keyword)}-${slugify(meta.location)}-${stamp}.json`;
  const file = path.join(OUTPUT_DIR, name);
  fs.writeFileSync(file, JSON.stringify({ meta, businesses }, null, 2));
  return file;
}

async function saveCsv(businesses, meta = {}) {
  ensureOutputDir();
  const csv = await buildCsv(businesses, meta);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${slugify(meta.keyword)}-${slugify(meta.location)}-${stamp}.csv`;
  const file = path.join(OUTPUT_DIR, name);
  fs.writeFileSync(file, csv);
  return file;
}

module.exports = { buildCsv, saveCsv, saveJson, toCsvRow, OUTPUT_DIR };
