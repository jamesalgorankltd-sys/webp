function decodeDeep(value) {
  let s = String(value || '');
  for (let i = 0; i < 4; i++) {
    try {
      const d = decodeURIComponent(s);
      if (d === s) break;
      s = d;
    } catch (_) { break; }
  }
  return s;
}
function absUrl(u, base) {
  try { return new URL(u, base).href; } catch (_) { return ''; }
}
function cleanCandidate(u) {
  if (!u) return '';
  u = decodeDeep(String(u).trim()).replace(/&amp;/g, '&');
  u = u.replace(/[\s"'<>]+$/g, '');
  return u;
}
function isBad(u) {
  return /(logo|icon|avatar|sprite|placeholder|tracking|pixel|adsbygoogle|favicon|blank\.gif|transparent)/i.test(u || '');
}
function isImageish(u) {
  return /^data:image\//i.test(u) || /\.(png|jpe?g|webp|gif|avif|bmp|svg)(\?|#|$)/i.test(u || '') || /\b(image|photo|media|cdn|upload|img)\b/i.test(u || '');
}
function addCandidate(out, seen, raw, base, score) {
  let u = cleanCandidate(raw);
  if (!u) return;
  if (u.startsWith('//')) u = 'https:' + u;
  if (!/^https?:\/\//i.test(u) && !/^data:image\//i.test(u)) u = absUrl(u, base);
  if (!/^https?:\/\//i.test(u) && !/^data:image\//i.test(u)) return;
  if (!isImageish(u)) return;
  if (isBad(u)) score -= 10000;
  const key = u.split('#')[0];
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ url: u, score });
}
function extractSrcset(srcset, base, out, seen, score) {
  String(srcset || '').split(',').forEach((part, i) => {
    const bits = part.trim().split(/\s+/);
    const size = parseInt(bits[1] || '', 10) || 0;
    addCandidate(out, seen, bits[0], base, score + size - i);
  });
}
function walkJson(x, base, out, seen, score) {
  if (!x) return;
  if (typeof x === 'string') { addCandidate(out, seen, x, base, score); return; }
  if (Array.isArray(x)) { x.forEach(v => walkJson(v, base, out, seen, score)); return; }
  if (typeof x === 'object') Object.entries(x).forEach(([k, v]) => {
    walkJson(v, base, out, seen, /image|photo|thumbnail|contentUrl|url/i.test(k) ? score + 2500 : score);
  });
}
function extractCandidatesFromHtml(html, base) {
  const out = [], seen = new Set();
  const metaPatterns = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["'][^>]*>/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["'][^>]*>/ig,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/ig,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/ig,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/ig
  ];
  metaPatterns.forEach((re, idx) => { let m; while ((m = re.exec(html))) addCandidate(out, seen, m[1], base, 50000 - idx); });

  let m;
  const ld = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/ig;
  while ((m = ld.exec(html))) {
    try { walkJson(JSON.parse(m[1]), base, out, seen, 42000); } catch (_) {}
  }
  const imgTag = /<(img|source)\b[^>]*>/ig;
  while ((m = imgTag.exec(html))) {
    const tag = m[0];
    const attrs = {};
    tag.replace(/([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g, (_, k, __, v1, v2, v3) => { attrs[k.toLowerCase()] = v1 || v2 || v3 || ''; return ''; });
    extractSrcset(attrs.srcset || attrs['data-srcset'] || '', base, out, seen, 33000);
    ['src','data-src','data-lazy-src','data-original','data-url','data-full','data-image','data-large_image','data-hires','data-zoom-image'].forEach((k, i) => addCandidate(out, seen, attrs[k], base, 30000 - i));
  }
  const cssUrl = /url\((['"]?)([^)'"\s]+)\1\)/ig;
  while ((m = cssUrl.exec(html))) addCandidate(out, seen, m[2], base, 18000);
  const rawUrl = /https?:\/\/[^\s"'<>\\]+/ig;
  while ((m = rawUrl.exec(html))) addCandidate(out, seen, m[0], base, 10000);

  return out.sort((a, b) => b.score - a.score).map(x => x.url).slice(0, 30);
}


async function extractCandidatesWithHeadlessBrowser(pageUrl) {
  let browser;
  try {
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteer = await import('puppeteer-core');
    browser = await puppeteer.launch({
      args: [...chromium.args, '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'],
      defaultViewport: { width: 1365, height: 900 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'accept-language': 'en-US,en;q=0.9',
      'upgrade-insecure-requests': '1'
    });
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    try { await page.waitForNetworkIdle({ idleTime: 900, timeout: 7000 }); } catch (_) {}
    try { await page.evaluate(() => window.scrollTo(0, Math.floor(document.body.scrollHeight * 0.35))); await new Promise(r => setTimeout(r, 1000)); } catch (_) {}
    const data = await page.evaluate(() => {
      const abs = (u) => { try { return new URL(u, location.href).href; } catch(e){ return ''; } };
      const items = [];
      const add = (url, score) => { if(url) items.push({url: abs(String(url).replace(/&amp;/g,'&').trim()), score}); };
      const meta = [
        'meta[property="og:image:secure_url"]','meta[property="og:image"]','meta[name="twitter:image"]','meta[name="twitter:image:src"]','meta[itemprop="image"]','link[rel="image_src"]'
      ];
      meta.forEach((sel, i) => { const el = document.querySelector(sel); add(el && (el.content || el.href), 90000 - i); });
      document.querySelectorAll('script[type="application/ld+json"]').forEach((sc) => {
        try {
          const walk = (x) => {
            if (!x) return;
            if (typeof x === 'string') { if (/\.(png|jpe?g|webp|gif|avif)(\?|#|$)|\/image\/|\/photo\/|cdn|img/i.test(x)) add(x, 78000); return; }
            if (Array.isArray(x)) return x.forEach(walk);
            if (typeof x === 'object') Object.entries(x).forEach(([k,v]) => { if (/image|photo|thumbnail|contentUrl|url/i.test(k)) { if (typeof v === 'string') add(v, 82000); else walk(v); } else walk(v); });
          };
          walk(JSON.parse(sc.textContent || '{}'));
        } catch(e) {}
      });
      document.querySelectorAll('img, picture source').forEach((el, i) => {
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : {width:0,height:0};
        const naturalW = el.naturalWidth || el.videoWidth || parseInt(el.getAttribute('width') || '0', 10) || rect.width || 0;
        const naturalH = el.naturalHeight || el.videoHeight || parseInt(el.getAttribute('height') || '0', 10) || rect.height || 0;
        const area = Math.round((naturalW || rect.width || 0) * (naturalH || rect.height || 0));
        const baseScore = 50000 + Math.min(area, 8000000) - i;
        const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset') || '';
        srcset.split(',').forEach((part, idx) => {
          const bits = part.trim().split(/\s+/); if (!bits[0]) return;
          const n = parseInt(bits[1] || '0', 10) || 0;
          add(bits[0], baseScore + n - idx);
        });
        ['currentSrc','src'].forEach((k) => add(el[k], baseScore));
        ['data-src','data-lazy-src','data-original','data-url','data-full','data-image','data-large_image','data-hires','data-zoom-image','data-thumb'].forEach((k, idx) => add(el.getAttribute(k), baseScore - idx));
      });
      document.querySelectorAll('[style]').forEach((el, i) => {
        const st = el.getAttribute('style') || '';
        const m = st.match(/url\((['"]?)(.*?)\1\)/i);
        if (m) add(m[2], 30000 - i);
      });
      return items;
    });
    return (data || [])
      .filter(x => x && x.url && /^https?:\/\//i.test(x.url))
      .filter(x => !/(logo|icon|avatar|sprite|placeholder|tracking|pixel|adsbygoogle|favicon|blank\.gif|transparent)/i.test(x.url))
      .sort((a,b) => (b.score || 0) - (a.score || 0))
      .map(x => x.url);
  } finally {
    try { if (browser) await browser.close(); } catch (_) {}
  }
}

async function fetchViaJinaReader(url) {
  const readerUrl = 'https://r.jina.ai/' + url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const r = await fetch(readerUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept': 'text/plain, text/markdown, */*',
        'Cache-Control': 'no-cache'
      }
    });
    if (!r.ok) throw new Error('Jina HTTP ' + r.status);
    const text = await r.text();
    return extractCandidatesFromHtml(text, url).concat(extractMarkdownImageCandidates(text, url));
  } finally { clearTimeout(timer); }
}

function extractMarkdownImageCandidates(text, base) {
  const out = [], seen = new Set();
  let m;
  const mdImg = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  while ((m = mdImg.exec(text || ''))) addCandidate(out, seen, m[1], base, 60000);
  const mdLink = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  while ((m = mdLink.exec(text || ''))) addCandidate(out, seen, m[1], base, 42000);
  const raw = /https?:\/\/[^\s)"'<>\\]+/g;
  while ((m = raw.exec(text || ''))) addCandidate(out, seen, m[0], base, 30000);
  return out.sort((a,b)=>b.score-a.score).map(x=>x.url);
}

function filterUsefulImageCandidates(arr, pageUrl) {
  return unique(arr || []).filter(u => {
    const s = String(u || '');
    if (!/^https?:\/\//i.test(s) && !/^data:image\//i.test(s)) return false;
    if (s.split('#')[0] === String(pageUrl || '').split('#')[0]) return false;
    if (/\.(html?|php|aspx?)(\?|#|$)/i.test(s)) return false;
    if (/(logo|icon|avatar|sprite|placeholder|tracking|pixel|adsbygoogle|favicon|blank\.gif|transparent)/i.test(s)) return false;
    return isImageish(s);
  });
}

async function fetchHtmlCandidates(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const r = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': new URL(url).origin + '/',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });
  clearTimeout(timer);
  const contentType = r.headers.get('content-type') || '';
  if (!r.ok) {
    const err = new Error('Page HTTP ' + r.status);
    err.status = r.status;
    throw err;
  }
  if (contentType.startsWith('image/')) return [r.url || url];
  const html = await r.text();
  return extractCandidatesFromHtml(html, r.url || url);
}

function unique(arr) {
  const out = [], seen = new Set();
  for (const u of arr || []) {
    const k = String(u || '').split('#')[0];
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(u);
  }
  return out;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST required' });
    const { url } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'Valid page url required' });
    let candidates = [];
    let fetchError = '';
    try { candidates = await fetchHtmlCandidates(url); }
    catch (e) { fetchError = e?.message || String(e); }

    // Strong fallback for sites that return 403/JS-rendered pages to normal server fetch.
    // This uses a real headless Chromium browser on Vercel and reads the actual pasted page,
    // not guessed img/free-photo URLs.
    // Jina Reader fallback: often succeeds when the target blocks Vercel/server fetch with 403.
    // It still reads the exact pasted page URL and extracts image links from the returned page/markdown.
    if (!candidates.length || /403|forbidden|Page HTTP 403/i.test(fetchError)) {
      try { candidates = unique([...(await fetchViaJinaReader(url)), ...candidates]); }
      catch (e) { fetchError = fetchError || (e?.message || String(e)); }
    }

    // Optional Chromium fallback only if packages are available on the deployment.
    if (!candidates.length || /403|forbidden|Page HTTP 403/i.test(fetchError)) {
      try { candidates = unique([...(await extractCandidatesWithHeadlessBrowser(url)), ...candidates]); }
      catch (e) { /* keep Jina/fetch result */ }
    }

    candidates = filterUsefulImageCandidates(candidates, url);
    if (!candidates.length) return res.status(200).json({ ok: false, error: fetchError || 'No image found on page', candidates: [] });
    return res.status(200).json({ ok: true, candidates: candidates.slice(0, 40), finalUrl: url, usedFallback: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
