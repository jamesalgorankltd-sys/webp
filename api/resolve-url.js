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

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST required' });
    const { url } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'Valid page url required' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    clearTimeout(timer);
    const contentType = r.headers.get('content-type') || '';
    if (!r.ok) return res.status(r.status).json({ ok: false, error: 'Page HTTP ' + r.status });
    if (contentType.startsWith('image/')) {
      return res.status(200).json({ ok: true, candidates: [r.url || url], contentType });
    }
    const html = await r.text();
    const candidates = extractCandidatesFromHtml(html, r.url || url);
    return res.status(200).json({ ok: true, candidates, contentType, finalUrl: r.url || url });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
