# Pl@ntNet accuracy spike

Phase 0 of the Conservatory ([#1](https://github.com/reclinerhead/conservatory/issues/1)). A hand-run script that sends our own plant photos to the Pl@ntNet identify API and scores the answers at the genus and species level, separately, because most of what we grow is a cultivar the classifier cannot name.

## Setup, once

```powershell
cd C:\WEBDEV\conservatory\spikes\plantnet
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

Get a free API key from [my.plantnet.org](https://my.plantnet.org/) and set it in the shell you run from. It is never passed on the command line and nothing here writes it to disk.

```powershell
$env:PLANTNET_API_KEY = "paste it here"
```

## Photos

**The quick way, and the one to start with:** drop ten unlabeled phone photos into a flat folder such as `photos-succulents/` (ignored by git). Each is identified and the top three candidates are printed for you to judge by eye. No naming, no scoring. If the right genus is in the top three for most of them, the spike has done its job.

**The scored way**, for any plant whose name you know, is one folder per name:

```
photos/
  Echeveria/                 genus only: scored at genus level
    shelf-a-1.jpg
    shelf-a-1_flower.jpg     organ hint from the suffix: _leaf _flower _fruit _bark
  Echeveria Lola/            genus + cultivar: still genus-only scoring
    pot3.jpg
  Hemerocallis fulva/        genus + species: scored at both levels
    bed-east.jpg
  Hosta/
    north-bed.jpg
```

Keep the two collections apart by running the script twice, on `photos-succulents/` and `photos-beds/`, so the write-up has a number for each.

## Run

```powershell
.venv\Scripts\python identify_spike.py photos-succulents
```

Add `--group` to send photos that share a stem (`shelf-a-1.jpg` and `shelf-a-1_flower.jpg`) as one query of up to five images, which is how the product would do it. Run once without and once with to see whether the second photo helps.

Add `--no-reject` to get candidates even for a photo the API would otherwise refuse with a 404. The default run counts those refusals, which is itself a finding.

Every raw response is cached in `out/responses/` (ignored by git), so re-running costs no quota. Delete a cached file to re-query that photo. The run writes `out/results.md` and `out/results.csv`, prints the headline numbers, and reports how much of the day's 500-query quota is left.

## Reading the numbers

- **Genus top-3** is the number that matters for the product. The confirmation screen shows three pills; if the right genus is among them, the owner can finish the name.
- **Species top-1** is the number not to trust for succulents. A nursery hybrid has no species to find.
- **Rejected** photos are the ones the product would have to hand straight to the "type a name" path.
