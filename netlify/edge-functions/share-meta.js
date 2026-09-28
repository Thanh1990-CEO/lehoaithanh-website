// netlify/edge-functions/share-meta.js
//
// Rewrites the Open Graph / Twitter Card <meta> tags in index.html's <head>
// when a request arrives with a "?id=" query parameter pointing at a specific
// listing, so that chat-app link-preview crawlers (Zalo, Facebook, Messenger,
// ...) — which fetch the raw HTML and never run client-side JS, and which
// never receive a URL's "#hash" fragment at all — see that listing's own
// title / area / amenities / phone / photo instead of the site's generic,
// same-for-everyone preview.
//
// This function must be a no-op (near-instant `context.next()` passthrough)
// for the overwhelming majority of requests to "/", since EVERY normal page
// load hits it. It must never turn a working page load into a broken one:
// any failure at any step (network, parsing, missing row, bad JSON, ...)
// falls back to serving the original, unmodified page.
//
// Data model reminder (see index.html's own Supabase config block for the
// canonical source of truth — these values are duplicated here on purpose,
// see the note below):
//   table "lht_listings": columns id (text), collection (text),
//     data (jsonb), status (text: 'pending' | 'approved' | 'rejected'),
//     created_at (timestamptz).
//   data jsonb shape varies a bit by collection:
//     - bds_listings                -> data.totalArea (number, m²)
//     - logistics/xn/da/pl_listings -> data.totalQty (number) + data.unit (string)
//     - media_posts                 -> no area/qty field at all
//   Common across all collections: data.title, data.amenities (string[],
//   optional), data.phone, data.imageIds (string[] of full public Supabase
//   Storage URLs, optional), data.description (media_posts only).

// ---------------------------------------------------------------------------
// SUPABASE CONFIG — intentionally duplicated from index.html's own inline
// <script> (search that file for "SUPABASE_URL" / "SUPABASE_ANON_KEY" /
// "SUPABASE_TABLE"). Edge functions run in an isolated Deno runtime with no
// access to the page's JS, so the same PUBLIC values are hardcoded here.
// This is the "anon"/"publishable" key — safe to embed server-side too; it
// is not the secret "service_role" key, and access is enforced by Supabase
// Row Level Security policies, not by keeping this string private.
// If the Supabase project ever changes, update BOTH copies (this file and
// index.html).
// ---------------------------------------------------------------------------
const SUPABASE_URL = 'https://kbpcmifwplbtggfcnfrx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_buS_4Iky59zQlMME9dn2NQ_1FqIwlVt';
const SUPABASE_TABLE = 'lht_listings';

// Same fallback image the site's baseline <meta property="og:image"> already
// points at (see index.html <head>) — used whenever a listing has no photo.
const FALLBACK_IMAGE = 'https://lehoaithanh.org/images/logo.jpg';

// Give the Supabase fetch a hard budget so a slow/unreachable database never
// makes a normal page load hang for a crawler or a real visitor.
const FETCH_TIMEOUT_MS = 3000;

function escapeHtmlAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Truncate to ~limit chars on a word boundary, appending an ellipsis if cut.
function truncate(s, limit) {
  const str = String(s || '').trim();
  if (str.length <= limit) return str;
  const cut = str.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

// Build a human "area" fragment appropriate to whichever collection this
// listing belongs to, handling collections that have no area/qty concept
// (e.g. media_posts) gracefully by returning ''.
function buildAreaText(data) {
  if (data == null) return '';
  if (data.totalArea != null && data.totalArea !== '' && !Number.isNaN(Number(data.totalArea)) && Number(data.totalArea) > 0) {
    return Number(data.totalArea).toLocaleString('vi-VN') + ' m²';
  }
  if (data.totalQty != null && data.totalQty !== '' && !Number.isNaN(Number(data.totalQty)) && Number(data.totalQty) > 0) {
    const unit = data.unit ? String(data.unit).trim() : '';
    return Number(data.totalQty).toLocaleString('vi-VN') + (unit ? ' ' + unit : '');
  }
  return '';
}

function buildOgTitle(data) {
  const title = (data && data.title) ? String(data.title).trim() : '';
  if (!title) return null;
  const areaText = buildAreaText(data);
  return areaText ? `${title} — ${areaText} — Lê Hoài Thanh` : `${title} — Lê Hoài Thanh`;
}

function buildOgDescription(data) {
  const parts = [];
  const amenities = Array.isArray(data && data.amenities) ? data.amenities.filter(Boolean) : [];
  if (amenities.length) {
    parts.push(amenities.slice(0, 6).join(' · '));
  } else if (data && data.description) {
    // media_posts (and any listing without amenities) fall back to its own description.
    parts.push(String(data.description).trim());
  }
  if (data && data.phone) {
    parts.push('Liên hệ: ' + String(data.phone).trim());
  }
  const combined = parts.filter(Boolean).join(' · ');
  return truncate(combined, 160);
}

function buildOgImage(data) {
  if (data && Array.isArray(data.imageIds) && data.imageIds.length && data.imageIds[0]) {
    return String(data.imageIds[0]);
  }
  return FALLBACK_IMAGE;
}

// Replace an existing <meta property="X" content="..."> (or name="X") tag's
// content value in place; if no such tag exists in the HTML, inject a new
// one right before </head> instead. Matching is done with a tolerant regex
// (attribute order/spacing can vary) rather than an exact literal match, so
// this keeps working even if the baseline tags are edited slightly later.
function upsertMeta(html, attr, key, value) {
  const escapedValue = escapeHtmlAttr(value);
  const re = new RegExp(
    `<meta\\s+${attr}=["']${key}["']\\s+content=["'][^"']*["']\\s*/?>`,
    'i'
  );
  const newTag = `<meta ${attr}="${key}" content="${escapedValue}">`;
  if (re.test(html)) {
    return html.replace(re, newTag);
  }
  if (html.indexOf('</head>') !== -1) {
    return html.replace('</head>', `${newTag}\n</head>`);
  }
  // No </head> found (shouldn't happen) — leave html untouched rather than guess.
  return html;
}

async function fetchListingRow(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(id)}&status=eq.approved&select=*`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      },
      signal: controller.signal
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async (request, context) => {
  let id;
  try {
    const url = new URL(request.url);
    id = url.searchParams.get('id');
  } catch (_e) {
    return context.next();
  }

  if (!id) {
    return context.next();
  }

  let row;
  try {
    row = await fetchListingRow(id);
  } catch (_e) {
    row = null;
  }

  if (!row || !row.data) {
    // Bad/old id, not-yet-approved listing, network error, timeout, ...
    // — always fall back to the normal generic page rather than break it.
    return context.next();
  }

  // From this point on we call context.next() exactly once. It fetches the
  // real index.html response — if anything below fails we fall back to
  // returning that same response's already-read body untouched (via `html`),
  // never by calling context.next() a second time (the platform only allows
  // one downstream call per request).
  const res = await context.next();
  let html;
  try {
    html = await res.text();
  } catch (_e) {
    // Couldn't even read the original body — nothing we can safely rewrite;
    // let the (unread) response pass through as-is.
    return res;
  }

  try {
    const data = row.data;
    const ogTitle = buildOgTitle(data);
    if (!ogTitle) {
      // No usable title on the row — nothing meaningful to show, bail out
      // and serve the original response body untouched.
      return new Response(html, res);
    }
    const ogDescription = buildOgDescription(data);
    const ogImage = buildOgImage(data);
    const ogUrl = request.url;

    let modified = html;
    modified = upsertMeta(modified, 'property', 'og:title', ogTitle);
    modified = upsertMeta(modified, 'property', 'og:description', ogDescription);
    modified = upsertMeta(modified, 'property', 'og:image', ogImage);
    modified = upsertMeta(modified, 'property', 'og:url', ogUrl);
    modified = upsertMeta(modified, 'name', 'twitter:card', 'summary_large_image');
    modified = upsertMeta(modified, 'name', 'twitter:title', ogTitle);
    modified = upsertMeta(modified, 'name', 'twitter:description', ogDescription);
    modified = upsertMeta(modified, 'name', 'twitter:image', ogImage);

    return new Response(modified, res);
  } catch (_e) {
    // Any parsing/replacement failure must never surface as a broken page —
    // fall back to the original, already-read HTML, unmodified.
    return new Response(html, res);
  }
};
