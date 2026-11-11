# The Conservatory

**A living inventory of the plants in a household, built from photos taken on a phone.**

The Conservatory is where a plant collection gets catalogued, named, and looked after. Point a phone at a succulent on a basement shelf or a lily in a flower bed, and the Conservatory identifies it, adds it to the collection, pulls together what is known about the species, and starts keeping its record: where it lives, when it arrived, what it looks like over time. Over time the collection becomes a dashboard a person actually wants to open, and the pots get tags that can be scanned.

It is being built for three gardeners in one family. One raises around 150 succulents and cacti under a grow light all year. Two keep large outdoor flower beds and have done so for decades. All three tried, at some point, to keep an index of what they own on paper, and all three gave up. The Conservatory is the version that does not get overwhelming.

It also teaches. All three have grown plants for years without ever being told what a genus is or why a nursery tag says 'Black Prince' instead of a species. Every horticultural term the app shows carries a small info mark that explains it in plain language, with an example from the person's own collection when there is one. Nobody should have to leave the app to understand the app.

> **Status:** Phases 0, 1 and 2 are built, and Phase 3 has started: plants are added from photos, named, kept, given a species page with a care sheet, tagged with a printed QR code, and checked for health from their photos, with a to-do list for what a check finds. Next are the care log and the reminders ([#39](https://github.com/reclinerhead/conservatory/issues/39)). It runs at the house, on orchid, for phones on the home Wi-Fi. This README is the design brief; the state of what is built lives in the [technical guide](docs/guide/README.md), and the look of every screen is defined in [`design/DESIGN.md`](design/DESIGN.md).

## What it looks like

### Dashboard
<img width="1373" height="1285" alt="The dashboard: the species grid, with the To do card leading the side column" src="https://github.com/user-attachments/assets/cd8209ee-1398-4d9b-8688-9042da54754d" />

### Species page
<img width="723" height="1147" alt="A species page: the title block with its light and watering pills, the gallery and About this species" src="https://github.com/user-attachments/assets/ff192d62-5f15-4d52-8945-ebaf2d0cd7df" />

### Species page: care sheet and relatives
<img width="1043" height="1310" alt="A species page's care sheet and Relatives you already have" src="https://github.com/user-attachments/assets/7522d587-2175-44da-b6ea-02df0a92c165" />

### Health check and to-do items
<img width="1356" height="1177" alt="A plant's page: the Health card with a check's findings, and the to-do lines under them" src="https://github.com/user-attachments/assets/9a3f5afa-9bae-4ba6-8739-3dd32056c7ba" />

## Lineage

The Conservatory is the fourth app in a family of home-scale projects, and it borrows deliberately from each:

- **[The Aviary](https://github.com/reclinerhead/aviary)** is the template. An always-on bird listener identifies species with a purpose-built classifier, an enrichment pass pulls each species' portrait and summary from Wikipedia, every species gets its own page, and a community hub gathers digests from field stations at family members' homes. The Conservatory follows that shape and runs on the same boxes.
- **[Hearth](https://github.com/reclinerhead/hearth)** contributes the uploader: a phone-first capture flow where a photo becomes a structured record, with browser-side compression so uploads survive a weak connection.
- **Échoes**, a private family archive, contributes the identification step. Its photo wizard shows suggestion pills with confidence, lets the person type a name instead, saves every confirmation immediately, and makes every mis-tap reversible. Those rules were learned with older family members as the users, and they carry over unchanged.

## What it does

- **Add a plant from photos.** One plant at a time, up to five photos of it: the flower, a leaf, the whole plant. Each plant becomes one identification job, and Fern, the worker on the household's station, sends all of its photos to a plant classifier together. The result is a short list of candidates with confidence, which the owner confirms, corrects, or replaces with the name on the nursery tag. On a computer, photos can be dragged onto the page from a folder.
- **Keep the collection.** Every confirmed plant is a *specimen*, known by its species' name, with a location (a shelf, a room, a bed), the date it arrived, whether it is still alive or was gifted or died, and a timeline of its photos. One photo is the plant's main photo, the one it is known by everywhere, and any photo opens full size. More photos go straight onto a plant from its own page, without naming it again.
- **Show the collection.** The dashboard is a grid of species, one tile per species, narrowed by place ("Shelf 2", "No location yet", "No longer here"), searched by any name, genus or family, and sorted by name or by what was added last. Beside it: what is waiting on the to-do list, the species that joined most recently, one species a day to get to know, the collection at a glance, and the families grown most. A strip at the top says how many plants are waiting for a name. Photos are squares everywhere, because most of them are portraits from a phone.
- **Know the species.** Each species has its own page: its light and watering at a glance beside the name, the Wikipedia summary and reference image (the owner's own photos lead once there are any, and any one of them can be chosen as the photo the species is known by), every specimen of that species in the household, a care sheet (light, water, soil, hardiness, fertilizing, dormancy) with the figures behind every line, its relatives in the collection, meaning other plants in the same genus or family, and its taxonomy from kingdom to species.
- **Check a plant's health.** On a plant's page, choose up to three of its photos, say what has been noticed or ask a question, and Fern has a vision model read them. The answer is a status, one sentence, and findings that each carry a likely cause and a remedy. Checks are kept on the plant's page, the latest one open. It is a model's reading of photos, not a diagnosis.
- **Keep a to-do list.** One tap puts a health check's finding on the to-do list, with its remedy. The list has its own page, a count in the top bar, and a card at the top of the dashboard's side column that turns amber while anything is waiting. Ticking an item off moves it to Done. A to-do outlives the check it came from.
- **Tag the pots.** Every specimen gets a QR code that opens its page. Choose the plants, start at the first free label on a part-used sheet, and print onto standard 30-up address labels (the Avery 5160 layout, in weatherproof stock for outdoors). Each label also carries the plant's name, species, place and number, so it means something without a phone. A tag's address never changes, and a plant's number is never reused, so a label printed today still opens the right plant in ten years.
- **Explain itself.** Genus, species, cultivar, family, specimen, confidence score, hardiness zone, dormancy: each one is a word with an info mark beside it, and the explanation uses the reader's own plants as the example where it can.

### Still to come

- **The care log** ([#40](https://github.com/reclinerhead/conservatory/issues/40)): watered, fertilized, repotted, bloomed, logged on a plant's page in a tap.
- **The care rhythm** ([#41](https://github.com/reclinerhead/conservatory/issues/41)): how often each species wants water and feeding, read from its care sheet and overridable per species.
- **Reminders** ([#42](https://github.com/reclinerhead/conservatory/issues/42)): worked out from the rhythm, the log and the season, grouped by location so a shelf of 40 succulents is one card ("Water Shelf 2 · 14 plants"), not 40. They appear as "Today's care" on the dashboard and on a Reminders page, apart from the to-do list, which holds only what its owner chose to keep from a health check. Frost warnings for the beds come after.
- **Lineage** ([#3](https://github.com/reclinerhead/conservatory/issues/3)): a cutting linked to the plant it came from, so a collection grown from cuttings gets a family tree for free.
- **An info mark on every term** ([#10](https://github.com/reclinerhead/conservatory/issues/10)): the confirm screen, the plant pages, the species page and the care sheet have theirs; the rest of the app follows.
- **The Flower Show** (Phase 4): each household publishes a digest, and a hub at the house gathers them into a family view with ribbons: most species, most families, bloom of the week, longest-lived plant. Two sisters with competing flower beds are the reason this feature exists.

## How identification works

Identification uses **[Pl@ntNet](https://plantnet.org/)**, a classifier trained on tens of millions of labeled plant photos, through its REST API. It is the BirdNET of plants: purpose-built, accurate at the species level for wild and common garden plants, and free for non-commercial use up to 500 identifications a day. A query carries one to five photos of the same plant and returns ranked species candidates with scores, a GBIF taxon ID, and scores rolled up by genus and family. The Conservatory is a hobby project that will never be commercial, so the free tier is the whole budget.

A general vision language model was considered and rejected. A local model through Ollama only runs at one house and is weak at species level. A cloud model costs per photo forever and is still worse than a classifier trained for the job. The language model's place is enrichment, where it runs once per species rather than once per photo.

**The owner always confirms.** Plants hold still, and the person photographing one usually already knows what it is. So identification is a suggestion, not a verdict: the top candidates as pills, each with its score, a name field with autocomplete against the species already in the collection, a field for the nursery tag's name, and the options to skip for now, call it the same plant as the last one, or mark the photo as not a plant. Confirming saves at once. A "Change" link reverses it and cleans up after the mistake. There is no false-positive problem to solve, because nothing enters the collection without a tap.

**What the classifier cannot do.** Most of what sits on a succulent shelf is not a species. It is a nursery cultivar or hybrid, often a cross between genera, and its name exists only on the tag it came with. Succulents in one genus also look alike, and the visible differences come from light and water rather than genetics. The realistic result is a confident genus and a shaky species guess. Garden beds have the same property in a milder form: hostas, daylilies, roses, and coleus are all cultivars.

The Phase 0 spike ([#1](https://github.com/reclinerhead/conservatory/issues/1)) measured this on thirteen photos from the succulent shelf before any interface existed. Nothing was rejected, houseplants came back at 0.72 to 0.91, and in 11 of 13 the top genus was right even where the species score was low: one Echeveria came back as three Echeveria species at 0.03 each, which is the classifier saying "Echeveria, species unknown" without being able to say it. What that shaped:

- **A genus pill.** When the top candidates agree on a genus and no species is confident, the confirm screen leads with "Echeveria · species unsure".
- **A low-confidence state.** When the best score is very low and the genera disagree, the name field comes first and the pills follow.
- **Cultivars are the owner's.** A species record carries the name from the nursery tag alongside the classifier's taxon.
- **Care keys on the genus** for a genus or a hybrid, which is how plant care works anyway.

The flower-bed half of the spike has not been run yet. Garden ornamentals are closer to what the classifier was trained on, so it is expected to be the easier set.

## Two ways to add a plant, one queue

The two gardeners outdoors have ordinary home Wi-Fi that does not reach the far bed, and no interest in installing anything on their phones. The one indoors is three steps from the router. Both are served by the same pipeline. The only difference is whether the person waits for the answer.

**From the camera roll, later.** Take photos in the garden with the normal camera app, which needs no signal: the flower if there is one, a leaf, the whole plant. Back inside, open the Conservatory on the house Wi-Fi and send them one plant at a time: choose that plant's photos (up to five), send it, and go on to the next without leaving the page. Each plant, with all its photos, becomes one queued job, so the classifier sees the flower and the leaf together. Come back whenever: the dashboard reserves a strip that reads "7 plants waiting for a name", and tapping it walks through them one plant per screen, with large pills and a "same plant as the last one" button that adds a plant's photos to the specimen just named. The camera roll is the offline mode. No service worker, no browser-side queue, nothing to break on an old phone.

**On the spot.** Take the photos in the app. Sending the plant creates the same job, the page follows it, and Fern's answer appears a few seconds later with the way to the confirm screen. An "add another photo of this plant" button there sends one more for a better answer. Walk away mid-way and the job simply waits in the strip.

**The queue is the resilience.** Jobs live in SQLite on the station and survive a restart. A worker drains them one at a time, which keeps the classifier calls well under the daily and concurrent caps and makes a dropped connection or a flaky DNS lookup a retry rather than a loss. Photos are resized in the browser to about 1280 px on the long side before upload, each sent as its own request with retry, so a drop on the third photo keeps the first two, and a plant's job is made only once all of its photos are in. iPhone photos arrive as HEIC, which most desktop browsers cannot draw, so the page decodes them itself before the resize.

Access from outside the house is not part of the first version. The station is reachable on its own LAN through the same public front door the Aviary uses, and that covers every flow above. The one thing a gardener might want from elsewhere, a look at their own collection, is what the flower show hub shows anyway.

## Enrichment

When the queue is idle, Fern fills in each species once, the first time it is confirmed anywhere in the household, and mirrors the Aviary's pass:

- **Wikipedia** supplies the summary and the reference image, with the owner's own photo as the hero once there is one.
- **GBIF** supplies the taxonomy. Family and genus are what power the relatives block and the dashboard's families, which are joins, not model calls.
- **A language model** writes the care sheet once, from the taxonomy, the first lines of the Wikipedia summary and the household's hardiness zone, and stores it. It is Claude Sonnet, called through the Vercel AI Gateway. A genus, or a hybrid, gets a sheet written for the genus as a whole. Every figure the sheet uses is kept with what it rests on, so it can be checked. A sheet costs a few cents, so a whole shelf of species is a one-time cost of a couple of dollars. Rewrite on the species page asks for a fresh one.

Fern also reads a plant's health when its owner asks ([#87](https://github.com/reclinerhead/conservatory/issues/87)): on the plant's page they choose up to three of its photos (one that shows the soil helps), say what they have noticed if they like, and can add whether it grows indoors or outdoors and under natural or artificial light. Fern sends the photos to a vision model (Claude Sonnet, through the same gateway) with those facts, the species, its care sheet's headlines and how long the plant has been in their care. The answer is a status, one sentence, what was seen with the likeliest cause and a remedy, how sure the reading is, and which photos would settle it; a question gets a direct reply, shown as a conversation. Checks are kept, so a plant's page shows the latest and the earlier ones, and any finished check can be deleted. A finding can be put on the to-do list, which keeps its own copy, so it stays when the check is deleted. An answer with a flawed part is trimmed and kept, not thrown away, since it has been paid for. A check is only ever started by a person, is tried once, costs a few cents, and the household has a daily cap. It is a model's reading of photos, not a diagnosis.

The web app only reads what Fern wrote. A page never waits on Wikipedia, GBIF or a model.

## Where it runs

On the same small boxes that run the Aviary, one per household, alongside it. The Aviary leaves those machines nearly idle. Each station has its own database and dashboard and never depends on the house.

Today that is one box, **orchid**, at the house, serving `https://conservatory.lan` to phones on the home Wi-Fi. Three systemd units run there: the web app, Fern, and a deploy watcher, so merging a pull request is the deploy. Caddy is the front door. The data lives outside the checkout, where a deploy cannot reach it. The field stations at the other households, and Tailscale between them for the hub to pull digests, come with Phase 4.

The code is a separate repository from the Aviary on purpose. Patterns are copied rather than shared until a second caller justifies a shared package. How to run, deploy, back up and roll back is in the guide's [ops spoke](docs/guide/ops.md).

## Tech stack

| Layer | Built with |
| --- | --- |
| Identification | Pl@ntNet API, with the owner confirming every result |
| Worker and storage | Fern: Python 3.13 (uv), SQLite in WAL mode, Pillow with pillow-heif |
| Web app | Next.js 16 (App Router), React 19 with the React Compiler, TypeScript, Tailwind CSS 4, `node:sqlite`, pnpm |
| Enrichment | Wikipedia (Action API) and GBIF; care sheets by Claude Sonnet through the Vercel AI Gateway, once per species |
| Health checks | Claude Sonnet reading a plant's photos, through the same gateway, only when the owner asks |
| Photos | Resized in the browser; HEIC decoded in the page with heic-to; full-size viewing with yet-another-react-lightbox |
| Tags | QR codes drawn on the server with `qrcode`, printed on letter-size label sheets from the browser |
| Station and ops | systemd, Caddy, git-driven autodeploy |
| Tests | pytest and Vitest on every pull request |

## Plan

- **Phase 0, the spike.** Done ([#1](https://github.com/reclinerhead/conservatory/issues/1)). A throwaway script ran the succulent shelf through Pl@ntNet and scored it at the genus and species level. Pl@ntNet stayed the identifier.
- **Phase 1, one household.** Done ([#4](https://github.com/reclinerhead/conservatory/issues/4)). Capture from the camera roll and on the spot, the job queue, the confirm screen, the collection and the plant pages, running on orchid.
- **Phase 2, the species.** Done ([#19](https://github.com/reclinerhead/conservatory/issues/19)). The enrichment pass, species pages, care sheets, relatives.
- **Phase 3, the pots.** In progress ([#39](https://github.com/reclinerhead/conservatory/issues/39)). Pot tags and label printing are built, and the health check and the to-do list arrived alongside them; the care log, the care rhythm and the reminders are next.
- **Phase 4, the flower show.** To come. Digests from each household, the hub, ribbons.

## Open questions

- Whether the Conservatory becomes the second mission on the family's shared mission platform or stays a sibling of the Aviary with copied patterns.
- The community hub is provisionally **the Flower Show**. The identification worker is settled: **Fern**, in the tradition of the Aviary's Earl and Willard.
- Reminders stay in the app for now: the dashboard strip, the Reminders page and a count on the nav pill ([#39](https://github.com/reclinerhead/conservatory/issues/39)). If they ever need to leave it, the candidate is a morning email from Fern; web push was ruled out because it needs an app installed to the home screen.

## Credits

Plant identification by [Pl@ntNet](https://plantnet.org/). Species summaries from Wikipedia. Taxonomy from [GBIF](https://www.gbif.org/).

## License

MIT.
