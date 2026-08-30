// Core Google Maps scraping logic using Playwright.
// Searches Google Maps for keyword + location, scrolls the results panel,
// and extracts business data from the rendered result cards.
//
// Note: Google Maps' DOM and client-side rendering change frequently. This
// parser targets the card structure (div.Nv2PK) used in current Google Maps.
// Because Google shows a "limited view" to logged-out sessions, some fields
// (especially phone/website, which require opening each full place page) may
// not be present. The scraper is resilient: it keeps whatever is available.

const { chromium } = require('playwright');

const MAPS_URL = 'https://www.google.com/maps/search/';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildSearchUrl({ keyword, location }) {
  const query = encodeURIComponent(`${keyword} ${location}`.trim());
  // Force English UI; add gl for US results.
  return `${MAPS_URL}${query}?hl=en&gl=us`;
}

// Count how many business result cards are rendered in the panel.
async function countCards(page) {
  return page
    .locator('div.Nv2PK, div[role="feed"] > div > div > a')
    .count()
    .catch(() => 0);
}

// Scroll the results panel to trigger loading of more listings.
async function scrollResults(page, maxResults, onProgress) {
  let lastCount = 0;
  let stagnant = 0;
  const feed = page.locator('div[role="feed"]');

  for (let round = 0; round < 150; round++) {
    const count = await countCards(page);
    if (onProgress) {
      onProgress({ stage: 'scrolling', total: maxResults, found: Math.min(count, maxResults) });
    }
    if (count >= maxResults) break;

    // Check if Google Maps reached the end of results
    const reachedEnd = await page
      .locator('.HlvSq, div:has-text("You\'ve reached the end of the list")')
      .count()
      .catch(() => 0);
    if (reachedEnd > 0) {
      break;
    }

    const feedCount = await feed.count().catch(() => 0);

    // 1. Scroll within the feed container directly
    if (feedCount > 0) {
      await feed
        .evaluate((el) => {
          el.scrollBy(0, 5000);
        })
        .catch(() => {});
    }

    // 2. Scroll the last rendered card into view
    const lastCard = page.locator('div.Nv2PK').last();
    if (await lastCard.count().catch(() => 0)) {
      await lastCard.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    }

    // 3. Mouse wheel on the feed element
    if (feedCount > 0) {
      const box = await feed.boundingBox().catch(() => null);
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
        await page.mouse.wheel(0, 3000).catch(() => {});
      }
    }

    await sleep(1500);

    const newCount = await countCards(page);
    if (newCount === lastCount) {
      stagnant++;
      // If stagnant, jiggle the scroll to wake up virtual scroll listener
      if (feedCount > 0) {
        await feed.evaluate((el) => el.scrollBy(0, -300)).catch(() => {});
        await sleep(300);
        await feed.evaluate((el) => el.scrollBy(0, 800)).catch(() => {});
      }
      if (stagnant >= 7) break;
    } else {
      stagnant = 0;
      lastCount = newCount;
    }
  }
}

// Parse a single result card's visible text into structured fields.
// Evaluates directly inside DOM to avoid Playwright locator timeouts.
async function parseCard(locator) {
  const result = await locator
    .evaluate((el) => {
      // Extract title
      const titleEl = el.querySelector('div.qBF1Pd, h3, .fontHeadlineSmall');
      const title = titleEl ? titleEl.textContent.trim() : '';

      // Extract rating
      const ratingEl = el.querySelector('.ZkP5Je, span[aria-label*="stars"], [aria-label*="star"]');
      let rating = ratingEl ? ratingEl.getAttribute('aria-label') || '' : '';
      const starMatch = rating.match(/([\d.]+)\s*stars?/i);
      if (starMatch) rating = starMatch[1];

      // Extract URL
      let url = el.getAttribute('href') || '';
      if (!url) {
        const linkEl = el.querySelector('a.hfpxzc, a[href*="/maps/place/"], a[href*="google.com/maps"]');
        if (linkEl) url = linkEl.href || linkEl.getAttribute('href') || '';
      }
      if (!url) {
        const anyA = el.querySelector('a');
        if (anyA) url = anyA.href || anyA.getAttribute('href') || '';
      }

      // Direct website if present
      let website = '';
      const webEl = el.querySelector(
        'a[data-value="Website"], a[aria-label*="website" i], a[data-tooltip*="website" i]'
      );
      if (webEl) {
        website = webEl.href || webEl.getAttribute('href') || '';
      }

      // Lines parsing
      const text = el.innerText || '';
      const lines = text
        .split('\n')
        .map((l) => l.replace(/\u00a0/g, ' ').trim())
        .filter(Boolean);

      let category = '';
      let address = '';
      let hours = '';
      let reviews = '';
      let phone = '';

      const ACTION_WORDS = new Set([
        'book online', 'book', 'call', 'directions', 'save', 'website', 'order online',
        'reserve a table', 'reserve', 'buy tickets', 'start order', 'menu', 'reviews',
        'share', 'view larger map', 'view all', 'quote', 'get quote', 'text',
      ]);

      const infoLines = lines.filter(
        (l) => l !== title && !ACTION_WORDS.has(l.toLowerCase().trim())
      );

      for (const line of infoLines) {
        const revMatch = line.match(/^\((\d+)\)(\s*reviews)?$/i);
        if (revMatch) {
          reviews = revMatch[1];
          continue;
        }
        if (/^[\d.\s()]+$/.test(line) || /^\d\.\d\s*\(\d+\)/.test(line)) {
          continue;
        }
        if (/open|opens|closed|closes|24 hours/i.test(line)) {
          hours = line;
          const phoneInLine = line.match(
            /(?:\+?\d{1,4}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}/
          );
          if (phoneInLine && phoneInLine[0].replace(/\D/g, '').length >= 7 && !phone) {
            phone = phoneInLine[0].trim();
          }
          continue;
        }
        if (line.includes('·') || /[A-Za-z0-9]/.test(line)) {
          const parts = line
            .split('·')
            .map((p) => p.replace(/[^\w\s.#\-,&']/g, '').trim())
            .filter((p) => p && !ACTION_WORDS.has(p.toLowerCase().trim()));

          if (!category && parts.length) {
            const candidate = parts[0];
            if (!/^[\d.\s()]+$/.test(candidate) && !/^\d\.\d/.test(candidate)) {
              category = candidate;
            }
          }
          const addrParts = parts.filter(
            (p) =>
              !/^[\d.\s()]+$/.test(p) &&
              p !== category &&
              (/\d/.test(p) ||
                /st|ave|rd|road|street|lane|blvd|hwy|box|uttara|dhaka|new york|suite/i.test(p))
          );
          if (addrParts.length) {
            address = addrParts[addrParts.length - 1];
          } else if (parts.length > 1 && !address) {
            address = parts[parts.length - 1];
          }
          for (const p of parts) {
            const pPhone = p.match(
              /(?:\+?\d{1,4}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}/
            );
            if (pPhone && pPhone[0].replace(/\D/g, '').length >= 7 && !phone) {
              phone = pPhone[0].trim();
            }
          }
        }
      }

      if (address && title && address !== title && address.toLowerCase().startsWith(title.toLowerCase())) {
        address = address.slice(title.length).replace(/^[,\s]+|[,\s]+$/g, '');
      }

      return {
        title: title || lines[0] || '',
        category,
        address,
        rating,
        reviews,
        hours,
        phone,
        website,
        image: '',
        url,
      };
    })
    .catch(() => ({}));

  if (result.website && result.website.includes('google.com/url?q=')) {
    try {
      const u = new URL(result.website);
      result.website = u.searchParams.get('q') || result.website;
    } catch {}
  }

  return {
    title: result.title || '',
    category: result.category || '',
    address: result.address || '',
    rating: result.rating || '',
    reviews: result.reviews || '',
    hours: result.hours || '',
    phone: result.phone || '',
    website: result.website || '',
    image: '',
    url: result.url || '',
  };
}

// Open a single card's place page and grab phone + website when present.
// Uses route abortion to disable heavy assets (images, fonts, media) for 3-5x speed.
async function enrichFromPlacePage(browserContext, cardUrl) {
  if (!/^https?/.test(cardUrl || '')) return { phone: '', website: '' };
  const page = await browserContext.newPage();
  page.setDefaultTimeout(15000);
  let phone = '';
  let website = '';
  try {
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    await page.goto(cardUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
    await page
      .waitForSelector(
        'a[data-item-id="authority"], button[data-item-id*="phone"], a[data-item-id*="phone"], h1',
        { timeout: 4000 }
      )
      .catch(() => {});

    phone = await page
      .$$eval('button[data-item-id*="phone"]', (els) =>
        els.map((e) => e.innerText.trim()).filter(Boolean)
      )
      .then((arr) => arr[0] || '')
      .catch(() => '');

    if (!phone) {
      phone =
        (await page
          .locator('a[data-item-id*="phone"][href^="tel:"]')
          .getAttribute('href')
          .catch(() => '')) || '';
      phone = phone.replace(/^tel:/, '');
    }

    website =
      (await page
        .locator('a[data-item-id*="authority"], a[aria-label*="website" i], a[data-item-id*="website"]')
        .first()
        .getAttribute('href')
        .catch(() => '')) || '';

    if (website && website.includes('google.com/url?q=')) {
      try {
        const u = new URL(website);
        website = u.searchParams.get('q') || website;
      } catch {}
    }
  } catch {
    /* ignore */
  }
  await page.close().catch(() => {});
  return { phone, website };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((b) => {
    const key = (b.title + '|' + b.address).toLowerCase();
    if (!key || key === '|' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function scrapeBusinesses({
  keyword,
  location,
  maxResults = 100,
  headless = true,
  onProgress,
  enrichDetails = true,
}) {
  const start = Date.now();

  const browser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  let context;

  try {
    context = await browser.newContext({
      viewport: { width: 1360, height: 900 },
      locale: 'en-US',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    const url = buildSearchUrl({ keyword, location });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);

    // Dismiss cookie / consent if present
    for (const sel of [
      'button[aria-label*="consent"]',
      'button[aria-label*="Accept all"]',
      'button[aria-label*="Reject all"]',
      'form[action*="consent"] button',
    ]) {
      const btn = page.locator(sel).first();
      if (await btn.count()) {
        await btn.click({ timeout: 3000 }).catch(() => {});
      }
    }

    await page.waitForSelector('div[role="feed"]', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);

    if (onProgress) onProgress({ stage: 'scrolling', total: maxResults, found: 0 });

    await scrollResults(page, maxResults, onProgress);
    await sleep(1000);

    // Collect card locators. Prefer rich cards, fall back to title anchors.
    let cardCount = await page.locator('div.Nv2PK').count().catch(() => 0);
    let cards;
    if (cardCount > 0) {
      cards = page.locator('div.Nv2PK');
    } else {
      cards = page.locator('div[role="feed"] > div > div > a');
      cardCount = await cards.count().catch(() => 0);
    }

    const total = Math.min(cardCount, maxResults);
    if (onProgress) onProgress({ stage: 'extracting', total, found: 0 });

    const businesses = [];
    const seenKeys = new Set();

    for (let i = 0; i < total; i++) {
      let locator =
        cardCount > 0
          ? page.locator('div.Nv2PK').nth(i)
          : page.locator('div[role="feed"] > div > div > a').nth(i);
      let biz = await parseCard(locator).catch(() => ({}));

      const key = (biz.title || '').toLowerCase() + '|' + (biz.address || '');
      if (!biz.title || key === '|' || seenKeys.has(key)) continue;
      seenKeys.add(key);

      businesses.push(biz);
      if (onProgress) onProgress({ stage: 'extracting', total, found: businesses.length });
    }

    // Concurrent place page enrichment to fetch website and phone numbers
    if (enrichDetails && businesses.length > 0) {
      const toEnrich = businesses.filter((b) => b.url && (!b.website || !b.phone));
      if (toEnrich.length > 0) {
        let enrichedCount = 0;
        const CONCURRENCY = 5;
        const queue = [...toEnrich];

        if (onProgress) {
          onProgress({
            stage: 'enriching',
            text: `Fetching websites & details (0/${toEnrich.length})…`,
            total: toEnrich.length,
            found: 0,
          });
        }

        const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
          while (queue.length > 0) {
            const biz = queue.shift();
            if (!biz) break;
            const details = await enrichFromPlacePage(context, biz.url);
            if (details.website && !biz.website) biz.website = details.website;
            if (details.phone && !biz.phone) biz.phone = details.phone;
            enrichedCount++;
            if (onProgress) {
              onProgress({
                stage: 'enriching',
                text: `Fetching websites & details (${enrichedCount}/${toEnrich.length})…`,
                total: toEnrich.length,
                found: enrichedCount,
              });
            }
          }
        });

        await Promise.all(workers);
      }
    }

    return {
      keyword,
      location,
      requested: maxResults,
      scraped: businesses.length,
      durationMs: Date.now() - start,
      businesses,
    };
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = { scrapeBusinesses, buildSearchUrl, dedupe, parseCard };
