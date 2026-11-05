# The Conservatory — design language

Reference for anyone (human or Claude Code) building screens. Read this before
touching UI. `tokens.css` holds the values as a Tailwind 4 `@theme`; the
`mockups/` folder holds two static HTML pages that show the whole language in
use: `dashboard.html` (collection / life list) and `species.html` (one species).
Open them in a browser. They are references, not app code — nothing in them is
meant to be copied in wholesale.

## 1. Feel

Organic, light, unhurried. A homeowner's garden notebook, not a SaaS dashboard.

- One pale sage ground, white cards, thin moss-coloured borders. Flat at rest;
  a card only lifts (soft shadow, stronger border) on hover.
- Everything you can press is a pill. Large targets (44 px minimum), generous
  padding, no hard corners anywhere except photos (22 px radius) and tiles.
- A serif for the things that matter to a plant person — the common name, the
  Latin binomial, the big counts — and a friendly humanist sans for the rest.
- One action colour (moss green). Pink exists only to mean "bloom". Amber only
  means "time-sensitive" (frost, bring it in). Blue only means "water". Never
  use these for decoration.
- No gradients, no emoji, no icon-only mystery buttons, no left-border cards.
  Icons are 1.8–2 px stroke line icons, inline SVG.
- Copy is plain and specific: "3 plants waiting for a name", "Water Fiddle",
  "Cut back the coneflowers, or leave the seed heads for the finches". The app
  talks about the owner's own plants by their common names whenever it can.

## 2. Colour

| Token | Hex | Use |
|---|---|---|
| `ground` | `#F3F6EF` | page background |
| `surface` | `#FFFFFF` | cards, inputs, chips at rest |
| `sage` | `#E8EFE2` | soft fills: side-panel tiles, pending strip, chip hover, care-sheet cells (on white use `ground`) |
| `sage-2` | `#DCE7D4` | active nav pill, pressed soft button |
| `line` / `line-2` | `#D3DECB` / `#C9D7BF` | card borders / control borders |
| `line-strong` | `#9DB896` | hover border, lineage connectors, info-mark ring |
| `ink` | `#1E2A1C` | text |
| `ink-2` | `#4F6149` | secondary text, labels, nav links (6:1 on ground) |
| `ink-3` | `#6B7B66` | placeholder text, author strings |
| `moss` / `moss-deep` | `#3F6E45` / `#2C5232` | the action colour and its hover |
| `bloom` / `bloom-ink` | `#F6E3EC` / `#8A3862` | bloom badges, "Blooming now" |
| `warn` / `warn-ink` | `#F7EBD2` / `#6E4A08` | frost, bring-indoors, repot-now |
| `water` / `water-ink` | `#DDEBF1` / `#1F4F63` | watering |

Rules: text on `ground` or `surface` is `ink` or `ink-2`, never a tint colour
on its own. Status tints are always a background + ink pair. Plants without a
photo get a tile in one of the five `tile-*` greens with a line-icon leaf; vary
the tint between neighbours so a grid doesn't look striped.

Contrast was checked for the pairs above (all ≥ 4.5:1 at body size). If you add
a colour, check it.

## 3. Type

- **Display:** Fraunces (variable, optical sizing on). Weight 500 for headings,
  400 italic for binomials. Letter-spacing −0.01em on headings. Used for: page
  titles, section titles, the italic Latin name, big numbers in stat tiles, and
  the wordmark.
- **Body:** Nunito Sans. 400 body, 600 for emphasised labels and links, 700 for
  names on cards and button labels.
- Scale (px): 52 page title · 40 greeting · 30 list title · 26 section title and
  binomial · 19 side-panel title · 17 lead/card name · 15 body · 13 meta · 12 tag.
- Latin names are always italic (`<em>`), including inside breadcrumbs and
  taxonomy tables. Authority strings ("(L.) Moench") are upright, smaller, `ink-3`.

## 4. Components

**Buttons** — pill, 44 px tall, 700 weight, icon + label with 8 px gap.
`primary` (moss fill, white text) for the one main action on a page.
`soft` (sage fill, line border) for secondary. `ghost` (transparent, line-2
border, moss text) for tertiary and "Snooze"-type choices. Compact 40 px
variant inside cards.

**Chips (filters)** — pill, 44 px, white with `line-2` border; selected = moss
fill, white text. Counts after the label at 400 weight, 80 % opacity.
Chips wrap; never scroll a chip row horizontally.

**Selects** — the chip's pill at the compact 40 px, 14/600, a drawn chevron in
40 px of right padding, a visible label to its left ("Sort by"). Native
`<select>`, so a phone gets its own big picker; every option's label sits
invisible in the same cell, so choosing never changes the width. On a mouse,
where the browser lets a `<select>` style its list, the open list is a white
card of 44 px pill rows: sage under the pointer, the chosen one moss and bold
with a check.

**Tags (status)** — 12 px / 700, 4 × 10 px padding, pill. Default = sage.
`bloom`, `warn`, `water` variants only for those meanings. A tag may carry a
tiny 11 px icon (the cutting/division "sprout" glyph).

**Card** — white, 1 px `line` border, 18 px radius. Main-column cards pad
28 × 32; side-panel cards pad 20. Hover (when the card is a link): border
`line-strong` plus `shadow-hover`.

**Specimen card** (species page, In your collection) — photo or tinted tile 168 px tall, then the
common name (17/700; the species when there is none), the italic species under
a common name (`ink-2`), "Location · since Month YYYY" (meta), then a row of
tags. The whole card is one `<a>`.

**Species tile** (life list) — the specimen card's shape: photo or tinted tile
168 px tall, the common name (17/700) with the italic binomial under it, or the
binomial alone in Fraunces italic with the line under it reserved, then a meta
line ("3 plants · 2 places"). One `<a>` to the species page.

**Relative card** (species page) — the same at 120 px photo height and
16 px radius, four across.

**Side-panel row** — 48 px thumb (12 px radius) + name link (700) + meta line,
hairline dividers between rows, none above the first.

**Stat tile** — sage fill, 14 px radius, 28 px Fraunces number over a meta
label. Two across in a side panel.

**Info mark** — 18 px ring in `line-strong`, "i" in moss, sits after the term
with 4 px gap. Clicking opens a sage note block (14 px radius) that explains the
term using the owner's own plants by name, with links to them. This is a
README requirement: every horticultural term gets one.

**Reminder card** — card with a status tag on top, bold one-line task, meta
line, Done + Snooze at the bottom. The time-sensitive one (frost) gets the
`warn-bg` fill and `warn-line` border so it reads first.

**Pending strip** — full-width sage card: three overlapping 48 px thumbs,
"N plants waiting for a name", one primary button.

**Lineage tree** — parent chip (sage fill) → 72 px connector with arrow →
column of child chips (white) with a 2 px `line-strong` rail on the left, and a
dashed ghost button "Log a cutting or division" at the bottom. Built from
placed flex elements, not an SVG, so it reflows. Same block for succulent
cuttings, divisions and offsets; the child's meta line says which.

**Breadcrumb** — Collection › Family › *Genus* › Common name, 14 px,
`ink-2` links, current page in `ink` 600.

**Photo gallery** — 3-column grid; hero spans two columns at 560 px, second
photo stacked right, then a 120 px reference thumb + "Add a photo". Each photo
carries a dark pill caption naming its source and date ("Your photo · Front bed
coneflower · Jul 12, 2026" / "Wikipedia"). Owner photos always outrank the
reference image. A plant is shown by its main photo, the one chosen for it, else
its newest; on its own page that is the hero, its caption ending "· Main photo".

**Lightbox** — a tap on any photo opens it full size over the page: the ink
backdrop nearly solid, white line-icon buttons (zoom, close, previous, next),
"2 of 5" top left. Under the photo, the caption pill at the left and at most
one action at the right as a white pill, 44 px: "Use as main photo" on a
plant's photos ("Main photo" in its place on the main one, so nothing moves),
or where the photo leads on the species page ("Open Ficus elastica", "The image and
its licence on Wikimedia Commons"). Escape, Close or the backdrop closes it,
and the page is where it was.

**QR pot tag** — a 7 × 7 module placeholder in the mockup; real tags are
generated per specimen and link to its page.

## 5. Page anatomy

**Top bar** (both pages, white, hairline bottom border): leaf mark + "The
Conservatory" in Fraunces 24 · nav pills (Collection, Tags, Locations,
Reminders, Flower Show; active = `sage-2` fill; Collection is lit on the
species and plant pages it leads to) · search (pill, leading icon,
"Search species") · primary "Add a plant" with camera icon. Wraps
to two rows on narrow screens.

**Dashboard** (`mockups/dashboard.html` for everything but the life list's
cards, which are species tiles, not specimen cards), top to bottom:
1. Greeting + date · zone · next weather event, with a tag or two of what needs
   attention today.
2. "Today's care" — 4 reminder cards in a row (wraps), link to all reminders.
3. Pending identifications strip.
4. Two columns, 28 px gap: **Life list** (`flex: 999 1 560px`) and a **side
   column** (`flex: 1 1 300px; max-width: 360px`) that drops below on phones.
   - Life list header: title, counts line, and Sort by (Name, A to Z or
     Latest added) on the right. Pot tags are printed from the Tags nav pill.
   - Filter chips by place: All · each place A to Z · No location yet · No
     longer here, each with its count. The mockup's other chips and selects
     (Houseplants, Blooming now, Family, Arrived) are not drawn; a family is
     found by typing it in the search.
   - 3-across species tiles (the specimen card's shape: 168 px photo, common
     name, italic binomial, a meta line for the chip on screen), each opening
     the species page; "Showing 9 of 42 species".
   - Side panels in order: New species added recently · Collection at a glance ·
     What you grow most · Blooming now · Flower Show (ribbons) · Get to know.
     The timely panels sit above the one that is always there.
   - New species added recently: the four species that joined last (a new pot
     of one already owned doesn't count), as side-panel rows, always four rows
     tall. No "All N species" foot link: the grid is beside it.
   - Collection at a glance: specimens · species · families · locations.
   - What you grow most: families by their living species, always five rows
     (the family, its count, a moss bar against the top family on a sage
     track, the genera owned in it), each opening the grid searched for the
     family; a foot line, "6 families in all", with any species not placed yet.
   - Get to know: one species a day, from those with a stored Wikipedia
     summary: its photo, names and meta line, the summary's first paragraph
     clamped to four lines, the care sheet's Light and Water headlines as tags,
     a link to its page. Every part keeps its height, empty included.

**Species page** (`mockups/species.html`):
1. Breadcrumb.
2. Title block: common name · italic binomial + authority · chips (family,
   habit, native range, zones, bloom months, "N in your collection") · right:
   Print pot tags (soft), Add a specimen (primary).
3. Photo gallery.
4. Two columns, same split as the dashboard.
   - Main: **About this species** (Wikipedia summary, source line with fetch
     date, article link, Refresh) · **Care sheet** (6 cells: Light, Water,
     Soil, Hardiness, Fertilizing, Dormancy; zone-aware; one info mark shown
     open) · **In your collection** (specimen cards + Lineage tree) ·
     **Relatives you already have** (Same genus, then Same family; honest
     empty-ish state when there's only one).
   - Side: Taxonomy (GBIF ranks + the owner's cultivar, with the Pl@ntNet
     confidence and a "Change" link) · Recent events (dot timeline; bloom
     events in `bloom-accent`) · Right now in zone N · Pot tags.

## 6. Responsive

Phone first in spirit, but the mockups are drawn at 1440. Rules that keep
them honest at 390: every row is `flex-wrap`; the side column is a flex sibling,
never sticky or `100vh`; the 3- and 4-across card grids go to 1-across below
~640 px and 2-across below ~1000 px; chip rows wrap; wide tables (table view)
scroll inside their own box; photo hero drops to 320 px tall.

## 7. Using this with Claude Code

Add a line to `CLAUDE.md`:

> UI work follows `design/DESIGN.md`. Tokens live in `design/tokens.css`
> (Tailwind 4 `@theme`, imported from `app/globals.css`). The static mockups
> in `design/mockups/` are the visual reference for the dashboard and species
> pages; match them, don't copy their markup.

Then ask for screens by their mockup section names ("build the Today's care
strip from the dashboard mockup as a server component").
