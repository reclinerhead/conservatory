# The Conservatory

**A living inventory of the plants in a household, built from photos taken on a phone.**

The Conservatory is where a plant collection gets catalogued, named, and looked after. Point a phone at a succulent on a basement shelf or a lily in a flower bed, and the Conservatory identifies it, adds it to the collection, pulls together what is known about the species, and starts keeping its record: where it lives, when it was repotted, when it bloomed, what it was propagated from. Over time the collection becomes a dashboard a person actually wants to open, and the pots get tags that can be scanned.

It is being built for three gardeners in one family. One raises around 150 succulents and cacti under a grow light all year. Two keep large outdoor flower beds and have done so for decades. All three tried, at some point, to keep an index of what they own on paper, and all three gave up. The Conservatory is the version that does not get overwhelming.

It also teaches. All three have grown plants for years without ever being told what a genus is or why a nursery tag says 'Black Prince' instead of a species. Every horticultural term the app shows carries a small info mark that explains it in plain language, with an example from the person's own collection when there is one. Nobody should have to leave the app to understand the app.

> **Status:** Phase 1 in progress. This README is the design brief; the state of what is built lives in the [technical guide](docs/guide/README.md).

## Lineage

The Conservatory is the fourth app in a family of home-scale projects, and it borrows deliberately from each:

- **[The Aviary](https://github.com/reclinerhead/aviary)** is the template. An always-on bird listener identifies species with a purpose-built classifier, an enrichment pass pulls each species' portrait and summary from Wikipedia, every species gets its own page, and a community hub gathers digests from field stations at family members' homes. The Conservatory follows that shape and runs on the same boxes.
- **[Hearth](https://github.com/reclinerhead/hearth)** contributes the uploader: a phone-first capture flow where a photo becomes a structured record, with browser-side compression so uploads survive a weak connection.
- **Échoes**, a private family archive, contributes the identification step. Its photo wizard shows suggestion pills with confidence, lets the person type a name instead, saves every confirmation immediately, and makes every mis-tap reversible. Those rules were learned with older family members as the users, and they carry over unchanged.

## What it will do

- **Add a plant from a photo.** Upload one photo or ten. Each becomes an identification job, and Fern, the worker on the household's station, sends it to a plant classifier. The result is a short list of candidates with confidence, which the owner confirms, corrects, or replaces with the name on the nursery tag.
- **Keep the collection.** Every confirmed plant is a *specimen* with a nickname, a location (a shelf, a room, a bed), the date it arrived, a photo timeline, and a log of events: watered, fertilized, repotted, bloomed, propagated, gifted, died. Propagation links a cutting to its parent, so a collection grown from cuttings gets a family tree for free.
- **Know the species.** Each species has its own page: the Wikipedia summary and reference image, its taxonomy, a care sheet (light, water, soil, hardiness, fertilizing cadence, dormancy), every specimen of that species in the household, and its relatives in the collection, meaning other plants in the same genus or family.
- **Tag the pots.** Every specimen gets a QR code that opens its page. Print them on label sheets, stick them on the pots, and scan one with the phone camera to find out what a plant is and when it was last watered. This is the pen-and-pencil index, done the cheap way.
- **Remind the gardener.** Care reminders derived from the species care sheet, the season, and the household's hardiness zone: fertilize the cacti now that they are growing again, stop watering the Echeverias for the winter, bring the tender things in before the first frost. Reminders start as a strip on the dashboard. Push comes later, if at all.
- **Explain itself.** Genus, species, cultivar, hybrid, family, confidence score, hardiness zone, dormancy: each one is a word with an info mark beside it, and the explanation uses the reader's own plants as the example.
- **Hold a flower show.** Each household publishes a digest, and a hub at the house gathers them into a family view with ribbons: most species, most families, bloom of the week, longest-lived plant. Two sisters with competing flower beds are the reason this feature exists.

## How identification works

Identification uses **[Pl@ntNet](https://plantnet.org/)**, a classifier trained on tens of millions of labeled plant photos, through its REST API. It is the BirdNET of plants: purpose-built, accurate at the species level for wild and common garden plants, and free for non-commercial use up to 500 identifications a day. A query carries one to five photos of the same plant, each tagged with the organ it shows (leaf, flower, fruit, bark), and returns ranked species candidates with scores and a GBIF taxon ID. The Conservatory is a hobby project that will never be commercial, so the free tier is the whole budget.

A general vision language model was considered and rejected. A local model through Ollama only runs at one house and is weak at species level. A cloud model costs per photo forever and is still worse than a classifier trained for the job. The language model's place is enrichment, where it runs once per species rather than once per photo.

**The owner always confirms.** Plants hold still, and the person photographing one usually already knows what it is. So identification is a suggestion, not a verdict: the top three candidates as pills, a name field with autocomplete against the species already in the collection, and the options to skip for now or mark the photo as not a plant. Confirming saves at once. A "Change" link reverses it and cleans up after the mistake. There is no false-positive problem to solve, because nothing enters the collection without a tap.

**What the classifier cannot do.** Most of what sits on a succulent shelf is not a species. It is a nursery cultivar or hybrid, often a cross between genera, and its name exists only on the tag it came with. Succulents in one genus also look alike, and the visible differences come from light and water rather than genetics. The realistic result is a confident genus and a shaky species guess. Garden beds have the same property in a milder form: hostas, daylilies, roses, and coleus are all cultivars. Three design consequences:

- A species record carries a user-supplied cultivar or variety alongside the classifier's taxon.
- Care sheets key on the genus, which is how plant care works anyway.
- The first thing built is a spike that measures genus-level and species-level accuracy separately on real photos from both kinds of collection.

## Two ways to add a plant, one queue

The two gardeners outdoors have ordinary home Wi-Fi that does not reach the far bed, and no interest in installing anything on their phones. The one indoors is three steps from the router. Both are served by the same pipeline. The only difference is whether the person waits for the answer.

**From the camera roll, later.** Take photos in the garden with the normal camera app, which needs no signal. Back inside, open the Conservatory on the house Wi-Fi, multi-select ten photos, and upload. Each photo becomes a queued job. Come back whenever: the dashboard reserves a strip that reads "7 plants waiting for a name", and tapping it walks through them one plant per screen, with large pills and a "same plant as the last one" button that merges two photos into one specimen. The camera roll is the offline mode. No service worker, no browser-side queue, nothing to break on an old phone.

**On the spot.** Take a photo in the app. The upload creates the same job, the page waits on it, and the pills appear in place a few seconds later. An "add another photo of this plant" button sends the leaf and the flower together for a better answer. Walk away mid-way and the job simply waits in the strip.

**The queue is the resilience.** Jobs live in SQLite on the station and survive a restart. A worker drains them one at a time, which keeps the classifier calls well under the daily and concurrent caps and makes a dropped connection or a flaky DNS lookup a retry rather than a loss. Photos are resized in the browser to about 1280 px on the long side before upload, each sent as its own request with retry, so a drop on photo seven keeps one through six.

Access from outside the house is not part of the first version. The station is reachable on its own LAN through the same public front door the Aviary uses, and that covers every flow above. The one thing a gardener might want from elsewhere, a look at their own collection, is what the flower show hub shows anyway.

## Enrichment

The enrichment pass runs once per species, the first time a species is confirmed anywhere in the household, and mirrors the Aviary's:

- **Wikipedia** supplies the summary and the reference image, with the owner's own photo as the hero once there is one.
- **GBIF** supplies the taxonomy. Family and genus are what power the relatives block, which is a join, not a model call.
- **A language model** writes the care sheet once, from the taxonomy and the household's hardiness zone, and stores it. Sixty species for a 150-plant collection is a one-time cost of pennies. Every figure the sheet uses is kept so it can be checked.

## Where it runs

On the same small boxes that run the Aviary, one per household, alongside it. The Aviary leaves those machines nearly idle. Each station has its own database and dashboard and never depends on the house. Deploys follow the Aviary's pattern: git-driven autodeploy with a promotion channel for the field stations, a Caddy front door, Tailscale between stations for the hub to pull digests. The code is a separate repository on purpose. Patterns are copied rather than shared until a second caller justifies a shared package.

## Tech stack (planned)

| Layer | Built with |
| --- | --- |
| Identification | Pl@ntNet API, with the owner confirming every result |
| Queue and storage | Python worker, SQLite |
| Web app | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, pnpm |
| Enrichment | Wikipedia and GBIF APIs; a language model for care sheets, once per species |
| Tags | QR codes rendered to printable label sheets |
| Stations and ops | systemd, Caddy, Tailscale, git-driven autodeploy |
| Tests | pytest and Vitest on every pull request |

## Plan

- **Phase 0, the spike.** A throwaway script runs twenty basement succulents and twenty flower-bed photos through Pl@ntNet and reports top-3 accuracy at the genus and species level. This decides the identifier before any interface exists.
- **Phase 1, one household.** Capture from the camera roll and on the spot, the job queue, the confirmation strip, and a dashboard of specimens. Runs at the house first.
- **Phase 2, the species.** Enrichment pass, species pages, care sheets, relatives.
- **Phase 3, the pots.** QR tags and label printing, the event log, the first care reminders.
- **Phase 4, the flower show.** Digests from each household, the hub, ribbons.

## Open questions

- Whether the Conservatory becomes the second mission on the family's shared mission platform or stays a sibling of the Aviary with copied patterns. Not needed before Phase 0.
- The community hub is provisionally **the Flower Show**. The identification worker is settled: **Fern**, in the tradition of the Aviary's Earl and Willard.
- Whether reminders ever leave the dashboard for push or email.

## Credits

Plant identification by [Pl@ntNet](https://plantnet.org/). Species summaries from Wikipedia. Taxonomy from [GBIF](https://www.gbif.org/).

## License

MIT.
