// CSV export helpers and disk persistence for scraped results.

const { stringify } = require('csv-stringify')
const fs = require('fs')
const path = require('path')

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'scraped-output')

const CRM_DEAL_VALUE_BY_TEMPERATURE = {
  HOT: 2500,
  WARM: 1500,
  COLD: 500,
}

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
]

function formatHours(hours) {
  if (!hours) return ''
  const entries = Array.isArray(hours) ? hours : [hours]
  return entries
    .map((h) => `${h.day || ''}: ${h.open || ''}-${h.close || ''}`)
    .filter(Boolean)
    .join('; ')
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePhone(phone) {
  const cleaned = cleanText(phone).replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
  if (!cleaned) return ''

  const digits = cleaned.replace(/[^\d+]/g, '')
  if (!digits) return cleaned

  if (digits.startsWith('+')) {
    const raw = digits.slice(1)
    if (raw.length > 10) {
      const country = raw.slice(0, raw.length - 10)
      const area = raw.slice(raw.length - 10, raw.length - 7)
      const prefix = raw.slice(raw.length - 7, raw.length - 4)
      const line = raw.slice(raw.length - 4)
      return `+${country}-${area}-${prefix}-${line}`
    }
    if (raw.length === 10) {
      return `+1-${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6)}`
    }
    return `+${raw}`
  }

  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  }

  return digits
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).replace(/[^\d.]+/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function getWebsiteStatus(business) {
  if (!business.website) return 'poor'
  if (
    business.email ||
    (business.emails && business.emails.length) ||
    business.contactPage
  )
    return 'excellent'
  return 'good'
}

function getMobileStatus(business) {
  if (!business.website) return 'poor'
  return 'good'
}

function getBookingSystem(business) {
  if (!business.website) return 'none'
  return 'unknown'
}

function getMainProblem(business) {
  if (!business.website) return 'No public website found'
  if (!business.email && !(business.emails || []).length)
    return 'No public email found'
  return 'Needs manual review for website, mobile, and booking quality'
}

function getLeadTemperature(business) {
  if (!business.website) return 'COLD'
  if (business.email || (business.emails && business.emails.length))
    return 'HOT'
  return 'WARM'
}

function getDealValue(leadTemperature) {
  return CRM_DEAL_VALUE_BY_TEMPERATURE[leadTemperature] || 1000
}

function toCrmRecord(business, meta = {}) {
  const leadTemperature = getLeadTemperature(business)
  const email = business.email || (business.emails || [])[0] || ''

  return {
    businessName: cleanText(business.title),
    niche: cleanText(business.category || meta.keyword),
    city: cleanText(meta.location),
    website: cleanText(business.website),
    email: cleanText(email),
    phone: normalizePhone(business.phone),
    googleMapsUrl: cleanText(business.url),
    rating: parseNumber(business.rating),
    reviews: parseNumber(business.reviews),
    websiteStatus: getWebsiteStatus(business),
    mobileStatus: getMobileStatus(business),
    bookingSystem: getBookingSystem(business),
    mainProblem: getMainProblem(business),
    leadTemperature,
    finalStatus: 'new',
    dealValue: getDealValue(leadTemperature),
    source: 'json_import',
    notes: cleanText(
      business.contactPage
        ? `Contact page found: ${business.contactPage}`
        : business.emails && business.emails.length
          ? `Public email discovered: ${business.emails[0]}`
          : 'Imported from Google Maps scrape',
    ),
  }
}

function toCsvRow(business, meta = {}) {
  const row = {
    Keyword: meta.keyword || '',
    Location: meta.location || '',
    'Business Name': business.title || '',
    Category: business.category || '',
    Address: business.address || '',
    Phone: business.phone || '',
    Website: business.website || '',
    'Google Maps URL': business.url || '',
    Rating: business.rating || '',
    'Review Count': business.reviews || '',
    Hours: formatHours(business.hours),
    Email: business.email || '',
    Emails: (business.emails || []).join('; '),
    'Contact Page': business.contactPage || '',
  }
  return row
}

function buildCsv(businesses, meta = {}) {
  const rows = businesses.map((b) => toCsvRow(b, meta))
  return new Promise((resolve, reject) => {
    stringify(rows, { header: true, columns: CSV_COLUMNS }, (err, out) => {
      if (err) return reject(err)
      resolve(out)
    })
  })
}

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function saveJson(businesses, meta = {}) {
  ensureOutputDir()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `${slugify(meta.keyword)}-${slugify(meta.location)}-${stamp}.json`
  const file = path.join(OUTPUT_DIR, name)
  const records = businesses.map((business) => toCrmRecord(business, meta))
  fs.writeFileSync(file, JSON.stringify(records, null, 2))
  return file
}

async function saveCsv(businesses, meta = {}) {
  ensureOutputDir()
  const csv = await buildCsv(businesses, meta)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `${slugify(meta.keyword)}-${slugify(meta.location)}-${stamp}.csv`
  const file = path.join(OUTPUT_DIR, name)
  fs.writeFileSync(file, csv)
  return file
}

module.exports = {
  buildCsv,
  saveCsv,
  saveJson,
  toCsvRow,
  toCrmRecord,
  OUTPUT_DIR,
}
