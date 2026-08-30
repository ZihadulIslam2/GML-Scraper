// Second-stage scraper: visits each business website and extracts publicly
// listed email addresses and discovers contact pages.
//
// It favors speed over completeness. By default it fetches the homepage and
// a small set of likely contact pages, then scans the HTML for mailto links
// and raw email strings.

const { chromium } = require('playwright');

const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const COMMON_BLOCKED =
  /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|pdf|zip|mp4|mp3|map)$/i;

const CONTACT_PATHS = [
  '/contact',
  '/contact-us',
  '/contactus',
  '/contact-',
  '/get-in-touch',
  '/contact.php',
  '/contact.html',
  '/pages/contact',
];

const URL_HINTS = ['contact', 'about', 'team', 'staff', 'support', 'services'];

function isLikelyContact(text) {
  const t = text.toLowerCase();
  return URL_HINTS.some((h) => t.includes(h));
}

function normalizeWebsite(raw) {
  if (!raw) return '';
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[/?#]/)[0]
    .trim()
    .toLowerCase();
}

function ensureProtocol(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function extractEmails(text) {
  const matches = text.match(EMAIL_REGEX) || [];
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    const e = m.trim().toLowerCase();
    if (COMMON_BLOCKED.test(m)) continue;
    if (!seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

// Visits a business website and returns emails + a contact page URL.
async function extractWebsiteEmails(browser, website, pagesToVisit = 3) {
  const base = ensureProtocol(website.trim());

  const context = await browser.newContext({
    locale: 'en-US',
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);

  const emails = new Map(); // email -> {page, via}
  const contactHints = new Set();
  const seenUrls = new Set();
  const okUrls = new Set();
  let pageCount = 0;

  const visitUrl = async (url) => {
    if (seenUrls.has(url)) return false;
    seenUrls.add(url);
    let html = '';
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (!resp || resp.status() >= 400) return false;
      await page.waitForTimeout(400);
      okUrls.add(url);
      pageCount++;
      html = await page.content().catch(() => '');
    } catch {
      return false;
    }
    const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    const plain = html.replace(/<[^>]+>/g, ' ') + '\n' + text;

    // raw emails
    extractEmails(plain).forEach((e) => {
      if (!emails.has(e)) emails.set(e, { page: url, via: 'body' });
    });

    // mailto links
    const mailtos = (html.match(/href=["']mailto:([^"'?]+)/gi) || []).map((m) =>
      m.replace(/href=["']mailto:/i, '').replace(/['"]$/i, '').trim().toLowerCase()
    );
    mailtos.forEach((e) => {
      if (e && !emails.has(e)) emails.set(e, { page: url, via: 'mailto' });
    });

    // discover contact links
    const links = await page
      .$$eval('a[href]', (as) => as.map((a) => a.href))
      .catch(() => []);
    for (const href of links) {
      if (isLikelyContact(href) && href.startsWith('http')) {
        contactHints.add(href.split('#')[0]);
      }
    }

    return true;
  };

  await visitUrl(base);

  // build contact candidate list
  let urlObj;
  try {
    urlObj = new URL(base);
  } catch {
    urlObj = null;
  }
  const hostBase = urlObj ? urlObj.origin : '';
  const candidates = [];
  if (hostBase) {
    for (const p of CONTACT_PATHS) candidates.push(hostBase + p);
    for (const hint of [...contactHints].slice(0, 20)) candidates.push(hint);
  } else {
    for (const hint of [...contactHints].slice(0, 20)) candidates.push(hint);
  }

  // visit a few more pages
  const distinct = [...new Set(candidates)];
  for (const c of distinct) {
    if (pageCount >= pagesToVisit || emails.size >= 10) break;
    await visitUrl(c);
  }

  let contactPage = null;
  for (const c of distinct) {
    if (/contact/i.test(c) && okUrls.has(c)) {
      contactPage = c;
      break;
    }
  }

  await context.close();

  return {
    emails: [...emails.keys()],
    emailDetails: [...emails.entries()].map(([email, info]) => ({ email, ...info })),
    contactPage,
  };
}

// Convenience: run email extraction over a list of businesses, with a fresh
// browser and basic concurrency.
async function enrichWithEmails(businesses, { concurrency = 4, pagesPerSite = 3 } = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const queue = [...businesses];
  const results = [];

  const worker = async () => {
    while (queue.length) {
      const biz = queue.shift();
      if (!biz.website) {
        results.push({ index: biz._index, ...biz, email: '', contactPage: null, emails: [] });
        continue;
      }
      try {
        const { emails, emailDetails, contactPage } = await extractWebsiteEmails(
          browser,
          biz.website,
          pagesPerSite
        );
        results.push({
          ...biz,
          email: emails[0] || '',
          emails,
          emailDetails,
          contactPage,
        });
      } catch (err) {
        // If the browser is no longer usable (crashed/closed), stop all work
        // rather than spin forever pushing garbage through it.
        if (/(Browser has been closed|Cannot use a page after|Target closed|browser.*closed)/i.test(String(err?.message || ''))) {
          queue.length = 0;
        }
        results.push({ ...biz, email: '', contactPage: null, emails: [] });
      }
    }
  };

  const workers = [];
  try {
    for (let i = 0; i < concurrency; i++) workers.push(worker());
    await Promise.all(workers);
  } finally {
    await browser.close().catch(() => {});
  }
  return results.sort((a, b) => (a._index || 0) - (b._index || 0));
}

module.exports = { extractWebsiteEmails, enrichWithEmails, normalizeWebsite, extractEmails };
