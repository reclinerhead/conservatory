"""Phase 0 spike: how well does Pl@ntNet identify our own plants?

Usage
-----
    $env:PLANTNET_API_KEY = "..."          # never on the command line
    python identify_spike.py photos            # one query per photo
    python identify_spike.py photos --group    # photos sharing a stem are one plant

Photo layout
------------
The quick way: a flat folder of photos, no names. Each is identified and the
top three candidates are printed for you to judge by eye. Nothing is scored.

The scored way, when you know what a plant is:

    photos/
      Echeveria/                 <- what you believe the plant is (genus only is fine)
        shelf-a-1.jpg
        shelf-a-1_flower.jpg     <- organ hint from the suffix: _leaf _flower _fruit _bark
      Echeveria Lola/            <- genus + cultivar: scored at genus level only
        pot3.jpg
      Hemerocallis fulva/        <- genus + species: scored at both levels
        bed-east.jpg

The folder name is the expected name. Its first word is the genus. Its second
word counts as the species only when it is lowercase (so "Echeveria Lola" and
"Echeveria 'Lola'" are genus-only, "Hemerocallis fulva" is a species).

With --group, files whose stem matches up to the first underscore are sent as
one query (max five images), e.g. shelf-a-1.jpg + shelf-a-1_flower.jpg.

Every raw response is cached in out/responses/ so re-running the scoring costs
no quota. Delete a cached file to re-query that photo. Results land in
out/results.md and out/results.csv.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import requests
from PIL import Image, ImageOps

try:  # iPhone photos arrive as HEIC; Pillow needs the opener registered
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:
    pass

API_URL = "https://my-api.plantnet.org/v2/identify/all"
ORGANS = {"leaf", "flower", "fruit", "bark"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic"}
LONG_SIDE = 1280
TOP_N = 3


# ----------------------------------------------------------------------------
# Pure logic: naming, grouping, scoring
# ----------------------------------------------------------------------------


@dataclass
class Expected:
    label: str
    genus: str
    species: str | None  # "Hemerocallis fulva" or None when only genus is known


def parse_expected(folder_name: str) -> Expected:
    """The folder name is what the owner believes the plant is."""
    words = folder_name.strip().split()
    genus = words[0].capitalize() if words else ""
    species = None
    if len(words) >= 2 and words[1].isalpha() and words[1].islower():
        species = f"{genus} {words[1]}"
    return Expected(label=folder_name.strip(), genus=genus, species=species)


def organ_from_name(path: Path) -> str:
    """shelf-a-1_flower.jpg -> flower; anything else -> auto."""
    stem = path.stem.lower()
    if "_" in stem:
        suffix = stem.rsplit("_", 1)[1]
        if suffix in ORGANS:
            return suffix
    return "auto"


def group_key(path: Path, grouped: bool) -> str:
    """With --group, photos sharing the stem before the first underscore are one plant."""
    if not grouped:
        return path.stem
    return path.stem.split("_", 1)[0]


@dataclass
class Candidate:
    species: str
    genus: str
    family: str
    score: float
    common: list[str] = field(default_factory=list)


def candidates_from_response(body: dict) -> list[Candidate]:
    out: list[Candidate] = []
    for r in body.get("results", []):
        sp = r.get("species", {})
        out.append(
            Candidate(
                species=sp.get("scientificNameWithoutAuthor", ""),
                genus=sp.get("genus", {}).get("scientificNameWithoutAuthor", ""),
                family=sp.get("family", {}).get("scientificNameWithoutAuthor", ""),
                score=float(r.get("score", 0.0)),
                common=list(sp.get("commonNames", []))[:2],
            )
        )
    return out


@dataclass
class Score:
    genus_top1: bool
    genus_top3: bool
    species_top1: bool | None  # None when the expected name has no species
    species_top3: bool | None


def score(expected: Expected, cands: list[Candidate]) -> Score:
    top = cands[:TOP_N]
    g1 = bool(top) and top[0].genus.lower() == expected.genus.lower()
    g3 = any(c.genus.lower() == expected.genus.lower() for c in top)
    if expected.species is None:
        return Score(g1, g3, None, None)
    s1 = bool(top) and top[0].species.lower() == expected.species.lower()
    s3 = any(c.species.lower() == expected.species.lower() for c in top)
    return Score(g1, g3, s1, s3)


def summarize(rows: list[dict]) -> dict[str, str]:
    """Headline numbers over the scored rows (rejections count as misses)."""

    def pct(hits: int, total: int) -> str:
        return "n/a" if total == 0 else f"{hits}/{total} ({100 * hits / total:.0f}%)"

    total = len(rows)
    genus_rows = [r for r in rows if r["expected_genus"]]
    species_rows = [r for r in rows if r["expected_species"]]
    return {
        "queries": str(total),
        "rejected (404)": str(sum(1 for r in rows if r["status"] == "rejected")),
        "genus top-1": pct(sum(r["genus_top1"] for r in genus_rows), len(genus_rows)),
        "genus top-3": pct(sum(r["genus_top3"] for r in genus_rows), len(genus_rows)),
        "species top-1": pct(sum(bool(r["species_top1"]) for r in species_rows), len(species_rows)),
        "species top-3": pct(sum(bool(r["species_top3"]) for r in species_rows), len(species_rows)),
    }


# ----------------------------------------------------------------------------
# I/O: images, the API, the cache, the reports
# ----------------------------------------------------------------------------


def prepare_image(path: Path) -> bytes:
    """Resize to 1280 px on the long side, JPEG q90, which is what the API does anyway."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((LONG_SIDE, LONG_SIDE))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=90)
        return buf.getvalue()


def identify(api_key: str, photos: list[Path], no_reject: bool, lang: str) -> tuple[int, dict]:
    files = [("images", (p.name, prepare_image(p), "image/jpeg")) for p in photos]
    data = [("organs", organ_from_name(p)) for p in photos]
    params = {"api-key": api_key, "nb-results": 5, "lang": lang}
    if no_reject:
        params["no-reject"] = "true"
    resp = requests.post(API_URL, params=params, files=files, data=data, timeout=60)
    try:
        body = resp.json()
    except ValueError:
        body = {"raw": resp.text}
    return resp.status_code, body


UNLABELED = Expected(label="(unlabeled)", genus="", species=None)


def collect_queries(root: Path, grouped: bool) -> list[tuple[Expected, str, list[Path]]]:
    """Named subfolders are scored; a flat folder of photos is just identified, for the eye."""
    queries = []
    folders = sorted(p for p in root.iterdir() if p.is_dir())
    sources = [(parse_expected(f.name), f) for f in folders] or [(UNLABELED, root)]
    for expected, folder in sources:
        groups: dict[str, list[Path]] = {}
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() in IMAGE_EXTS:
                groups.setdefault(group_key(f, grouped), []).append(f)
        for key, photos in groups.items():
            queries.append((expected, key, photos[:5]))
    return queries


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("photos", type=Path, help="folder of <expected name>/<photo> files")
    ap.add_argument("--group", action="store_true", help="send photos sharing a stem as one query")
    ap.add_argument("--no-reject", action="store_true", help="ask for candidates even when the API would reject")
    ap.add_argument("--lang", default="en")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    ap.add_argument("--sleep", type=float, default=0.5, help="seconds between live calls")
    args = ap.parse_args()

    api_key = os.environ.get("PLANTNET_API_KEY", "")
    if not api_key:
        print("PLANTNET_API_KEY is not set", file=sys.stderr)
        return 2
    if not args.photos.is_dir():
        print(f"not a folder: {args.photos}", file=sys.stderr)
        return 2

    cache_dir = args.out / "responses"
    cache_dir.mkdir(parents=True, exist_ok=True)

    queries = collect_queries(args.photos, args.group)
    print(f"{len(queries)} queries from {args.photos}")

    rows: list[dict] = []
    remaining = None
    for expected, key, photos in queries:
        cache_file = cache_dir / f"{expected.label}__{key}.json".replace(" ", "_").replace("'", "")
        if cache_file.exists():
            cached = json.loads(cache_file.read_text(encoding="utf-8"))
            status, body = cached["status"], cached["body"]
            source = "cache"
        else:
            status, body = identify(api_key, photos, args.no_reject, args.lang)
            cache_file.write_text(json.dumps({"status": status, "body": body}, indent=1), encoding="utf-8")
            source = "live"
            time.sleep(args.sleep)

        if status == 429:
            print("daily quota exhausted (429); stopping. Cached results are kept.", file=sys.stderr)
            cache_file.unlink(missing_ok=True)
            break

        if status == 200:
            cands = candidates_from_response(body)
            remaining = body.get("remainingIdentificationRequests", remaining)
            state = "ok" if cands else "empty"
        elif status == 404:
            cands = []
            state = "rejected"
        else:
            cands = []
            state = f"http {status}"

        sc = score(expected, cands)
        top = cands[:TOP_N]
        rows.append(
            {
                "expected": expected.label,
                "expected_genus": expected.genus,
                "expected_species": expected.species or "",
                "photos": ", ".join(p.name for p in photos),
                "status": state,
                "top1": f"{top[0].species} ({top[0].score:.2f})" if top else "",
                "top3": " | ".join(f"{c.species} {c.score:.2f}" for c in top),
                "genus_top1": sc.genus_top1,
                "genus_top3": sc.genus_top3,
                "species_top1": sc.species_top1,
                "species_top3": sc.species_top3,
            }
        )
        if expected.genus:
            mark = "G" if sc.genus_top3 else "-"
            mark += "S" if sc.species_top3 else ("." if sc.species_top3 is None else "-")
            print(f"[{source:5}] {mark} {expected.label:30} -> {rows[-1]['top1'] or state}")
        else:
            print(f"[{source:5}] {photos[0].name:30} -> {rows[-1]['top3'] or state}")

    if not rows:
        return 1

    summary = summarize(rows)
    args.out.mkdir(parents=True, exist_ok=True)

    with (args.out / "results.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    lines = ["# Pl@ntNet spike results", ""]
    lines += [f"- **{k}:** {v}" for k, v in summary.items()]
    if remaining is not None:
        lines.append(f"- **quota remaining today:** {remaining}")
    lines += ["", "| expected | status | top-1 | top-3 | genus | species |", "| --- | --- | --- | --- | --- | --- |"]
    for r in rows:
        g = "" if not r["expected_genus"] else ("✓" if r["genus_top3"] else "✗")
        s = "" if r["species_top1"] is None else ("✓" if r["species_top3"] else "✗")
        name = r["expected"] if r["expected_genus"] else r["photos"]
        lines.append(f"| {name} | {r['status']} | {r['top1']} | {r['top3']} | {g} | {s} |")
    (args.out / "results.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print()
    for k, v in summary.items():
        print(f"{k:>16}: {v}")
    if remaining is not None:
        print(f"{'quota left':>16}: {remaining}")
    print(f"\nwrote {args.out / 'results.md'} and results.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
