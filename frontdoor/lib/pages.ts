// =============================================================================
// The Conservatory -- frontdoor/lib/pages.ts
//
// The human-facing answers of the front door, rendered as HTML strings from
// route handlers (no React tree in this app). They speak the Conservatory's
// language (design/DESIGN.md): the pale sage ground, one white card with a
// thin border, the leaf mark and the wordmark as the top bar draws them,
// Fraunces for the one big line and Nunito Sans for the reading text, moss
// for links. Status is a tint paired with its ink, never a colour alone, and
// amber keeps its one meaning, "waiting on you". Nothing moves. The token
// values are COPIED from design/tokens.css, not imported: this app has no
// Tailwind and no build step for CSS, and the house rule is copy, don't
// share. The two faces are self-hosted from /public/fonts (the latin files
// next/font fetches for the web app), so the page asks Google for nothing.
//
// Every value interpolated here is either validated upstream (slug, ip) or
// escaped below; both, where it costs nothing.
// =============================================================================

import { CONSERVATORY_PREFIX, describeAge, type StationRecord } from "./frontdoor";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const STYLE = `
@font-face{font-family:"Fraunces";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/fraunces-latin.woff2") format("woff2")}
@font-face{font-family:"Nunito Sans";font-style:normal;font-weight:400 700;font-display:swap;src:url("/fonts/nunito-sans-latin.woff2") format("woff2")}
:root{--ground:#F3F6EF;--surface:#FFFFFF;--sage:#E8EFE2;--line:#D3DECB;--line-2:#C9D7BF;--line-strong:#9DB896;
--ink:#1E2A1C;--ink-2:#4F6149;--ink-3:#6B7B66;--moss:#3F6E45;--moss-deep:#2C5232;--warn:#F7EBD2;--warn-ink:#6E4A08;
--font-display:"Fraunces",Georgia,serif;--font-sans:"Nunito Sans",system-ui,sans-serif}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{background:var(--ground);color:var(--ink);font-family:var(--font-sans);font-size:17px;line-height:1.55;display:grid;place-items:center;padding:24px 16px;-webkit-font-smoothing:antialiased}
main{width:min(100%,560px);background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:28px 32px 30px}
.brand{display:flex;align-items:center;gap:10px;margin:0 0 22px;font-family:var(--font-display);font-weight:500;font-size:22px;letter-spacing:-.01em;color:var(--ink)}
.brand svg{flex:none;color:var(--moss)}
h1{margin:0 0 14px;font-family:var(--font-display);font-weight:500;font-size:clamp(30px,7vw,40px);line-height:1.12;letter-spacing:-.01em;overflow-wrap:anywhere}
p{margin:0 0 12px;max-width:62ch}
p:last-child{margin-bottom:0}
.meta{color:var(--ink-2);font-size:15px}
.foot{margin-top:22px;padding-top:16px;border-top:1px solid var(--line);color:var(--ink-2);font-size:15px}
a{color:var(--moss);font-weight:600;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}
a:hover{color:var(--moss-deep)}
a:focus-visible{outline:2px solid var(--moss);outline-offset:3px;border-radius:4px}
.addr{font-weight:700;color:var(--ink)}
.tag{display:inline-block;vertical-align:middle;margin-left:12px;padding:4px 12px;border-radius:999px;border:1px solid transparent;font-family:var(--font-sans);font-size:13px;font-weight:700;letter-spacing:0;line-height:1.4}
.tag.up{background:var(--sage);color:var(--moss-deep)}
.tag.quiet{background:var(--surface);color:var(--ink-2);border-color:var(--line-2)}
.tag.gone{background:var(--warn);color:var(--warn-ink)}
.facts{margin:20px 0 0;background:var(--ground);border-radius:14px;padding:18px 20px}
.facts dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:10px 22px}
.facts dt{color:var(--ink-2);font-size:15px;font-weight:600;padding-top:1px}
.facts dd{margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.facts .blank{color:var(--ink-3)}
@media (max-width:420px){main{padding:22px 20px 24px}.facts{padding:16px}.facts dl{grid-template-columns:1fr;gap:2px}.facts dd{margin-bottom:10px}.facts dd:last-child{margin-bottom:0}}
`;

// The leaf mark, as web/components/topbar.tsx draws it.
const LEAF = `<svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4c-8 0-14 5-14 13 0 1 .1 2 .3 3"/><path d="M20 4c0 8-5 14-13 14"/><path d="M6 21c2-6 6-10 11-13"/></svg>`;

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#F3F6EF">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<p class="brand">${LEAF}The Conservatory</p>
${body}
</main>
</body>
</html>
`;
}

export function landingPage(): string {
  return shell(
    "The Conservatory front door",
    `<h1>The front door</h1>
<p>Each house that keeps a Conservatory has its own link here, and that link always leads to the box in that house, wherever it sits on the home Wi-Fi this week. Open the one you were given.</p>
<p class="foot">A Conservatory opens only from inside its own house. This page keeps no plants and lists no houses.</p>`,
  );
}

export function unknownStationPage(): string {
  return shell(
    "No such station",
    `<h1>That link doesn't lead to a house</h1>
<p>Check the link you were given. A house's link looks like <span class="addr">conservatory.toddtech.llc/name</span>, all lowercase.</p>`,
  );
}

export function notReportedPage(station: string): string {
  return shell(
    `${station} hasn't reported yet`,
    `<h1>${esc(station)} hasn't checked in yet</h1>
<p>The box tells this page where it lives on its home network the first time it comes online. Until then there is nowhere to send you.</p>
<p class="meta">If the box is plugged in and its light is on, give it a few minutes and try again.</p>`,
  );
}

export function statusPage(station: string, rec: StationRecord, now: Date = new Date()): string {
  const ageS = (now.getTime() - Date.parse(rec.seen_at)) / 1000;
  const tag = Number.isNaN(ageS)
    ? `<span class="tag gone">Not heard from</span>`
    : ageS <= 20 * 60
      ? `<span class="tag up">Up</span>`
      : ageS <= 24 * 3600
        ? `<span class="tag quiet">Quiet</span>`
        : `<span class="tag gone">Not heard from</span>`;
  const blank = `<span class="blank">Not reported</span>`;
  return shell(
    `${station}: station status`,
    `<h1>${esc(station)}${tag}</h1>
<p>Last heard from <strong>${esc(describeAge(rec.seen_at, now))}</strong>. The address below is the box itself, and it opens only from inside its house.</p>
<div class="facts">
<dl>
<dt>Address</dt><dd><a href="/${esc(station)}">http://${esc(rec.ip)}/${CONSERVATORY_PREFIX}</a></dd>
<dt>Wi-Fi interface</dt><dd>${rec.iface ? esc(rec.iface) : blank}</dd>
<dt>Aviary build</dt><dd>${rec.sha ? esc(rec.sha) : blank}</dd>
<dt>Checked in</dt><dd>${esc(rec.seen_at)}</dd>
</dl>
</div>
<p class="foot">Up means heard from within 20 minutes, quiet within a day. Longer than that and the address is still the best guess. The build is the Aviary's on that box; the Conservatory's own is on the box's check page.</p>`,
  );
}
