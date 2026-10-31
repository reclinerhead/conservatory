"""The Pl@ntNet parser and outcome classifier, against the response shapes the API sends."""

from datetime import datetime, timezone

from fern import plantnet

NOW = datetime(2026, 10, 31, 15, 0, tzinfo=timezone.utc)


def species(name, genus, family, score, gbif="1", common=()):
    return {
        "score": score,
        "species": {
            "scientificNameWithoutAuthor": name,
            "scientificName": f"{name} L.",
            "genus": {"scientificNameWithoutAuthor": genus, "scientificName": genus},
            "family": {"scientificNameWithoutAuthor": family, "scientificName": family},
            "commonNames": list(common),
        },
        "gbif": {"id": gbif},
    }


# Photo 1 of the Phase 0 run (#1): a rubber plant at 0.80, nothing close behind.
FICUS = {
    "bestMatch": "Ficus elastica Roxb. ex Hornem.",
    "remainingIdentificationRequests": 499,
    "results": [
        species("Ficus elastica", "Ficus", "Moraceae", 0.80486, "5361903", ["Rubberplant", "Indian rubberplant", "Rubber Plant", "Extra"]),
        species("Ficus robusta", "Ficus", "Moraceae", 0.04),
        species("Ficus rubiginosa", "Ficus", "Moraceae", 0.003),
    ],
}

# Photo 11: three Echeverias at 0.03 each, the cultivar case.
ECHEVERIA = {
    "remainingIdentificationRequests": 490,
    "results": [
        species("Echeveria gigantea", "Echeveria", "Crassulaceae", 0.03),
        species("Echeveria pulidonis", "Echeveria", "Crassulaceae", 0.02),
        species("Echeveria secunda", "Echeveria", "Crassulaceae", 0.02),
        species("Sedum morganianum", "Sedum", "Crassulaceae", 0.01),
    ],
}


def test_species_candidates_keep_rank_names_and_three_common_names():
    cands = [c for c in plantnet.parse_candidates(FICUS) if c.kind == "species"]
    assert [c.rank for c in cands] == [1, 2, 3]
    top = cands[0]
    assert top.scientific_name == "Ficus elastica"
    assert top.genus == "Ficus" and top.family == "Moraceae"
    assert top.gbif_id == "5361903"
    assert top.common_names == ["Rubberplant", "Indian rubberplant", "Rubber Plant"]
    assert top.score == 0.80486


def test_rollups_sum_species_scores_per_genus_and_family():
    cands = plantnet.parse_candidates(ECHEVERIA)
    genera = [c for c in cands if c.kind == "genus"]
    assert [(g.scientific_name, g.score) for g in genera] == [("Echeveria", 0.07), ("Sedum", 0.01)]
    assert genera[0].family == "Crassulaceae"
    families = [c for c in cands if c.kind == "family"]
    assert [(f.scientific_name, f.score) for f in families] == [("Crassulaceae", 0.08)]


def test_other_results_from_the_api_win_over_computed_rollups():
    body = dict(FICUS)
    body["otherResults"] = {
        "genus": [{"score": 0.9, "genus": {"scientificNameWithoutAuthor": "Ficus"}}],
        "family": [{"score": 0.95, "family": {"scientificNameWithoutAuthor": "Moraceae"}}],
    }
    cands = plantnet.parse_candidates(body)
    assert [(c.kind, c.scientific_name, c.score) for c in cands if c.kind != "species"] == [
        ("genus", "Ficus", 0.9),
        ("family", "Moraceae", 0.95),
    ]


def test_classify_200_is_identified_with_quota():
    out = plantnet.classify(200, FICUS, {}, NOW)
    assert out.status == "identified"
    assert out.remaining == 499
    assert out.candidates[0].scientific_name == "Ficus elastica"


def test_classify_200_without_species_is_rejected():
    assert plantnet.classify(200, {"results": []}, {}, NOW).status == "rejected"


def test_classify_404_is_rejected_and_429_pauses_until_retry_after():
    assert plantnet.classify(404, {"message": "Species not found"}, {}, NOW).status == "rejected"
    out = plantnet.classify(429, {}, {"Retry-After": "Sat, 01 Nov 2026 00:00:00 GMT"}, NOW)
    assert out.status == "quota"
    assert out.resume_at == datetime(2026, 11, 1, 0, 0, tzinfo=timezone.utc)


def test_429_without_a_usable_date_waits_for_utc_midnight():
    out = plantnet.classify(429, {}, {"retry-after": "garbage"}, NOW)
    assert out.resume_at == datetime(2026, 11, 1, 0, 0, tzinfo=timezone.utc)
    stale = plantnet.classify(429, {}, {"retry-after": "Fri, 30 Oct 2026 00:00:00 GMT"}, NOW)
    assert stale.resume_at == datetime(2026, 11, 1, 0, 0, tzinfo=timezone.utc)


def test_client_errors_fail_for_good_and_server_errors_retry():
    assert plantnet.classify(401, {"message": "bad key"}, {}, NOW).status == "failed"
    assert plantnet.classify(400, {}, {}, NOW).status == "failed"
    assert plantnet.classify(503, {}, {}, NOW).status == "retry"
    assert plantnet.classify(0, {"error": "connection reset"}, {}, NOW).status == "retry"
