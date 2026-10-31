"""Run Fern: `python -m fern`.

Opens the database, applies the schema, and drains the identification queue
against Pl@ntNet until stopped; when the queue is idle, enriches one species
per tick from GBIF and Wikipedia (#20).

    python -m fern                 the worker
    python -m fern --enrich 1      re-enrich species 1 by hand, then exit

Environment:
    CONSERVATORY_DB     path to the SQLite file (default data/conservatory.db)
    CONSERVATORY_DATA   directory for photos and reference images (default data/)
    PLANTNET_API_KEY    the Pl@ntNet key; Fern refuses to start without it
                        (not needed for --enrich, which never calls Pl@ntNet)
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
from pathlib import Path

from . import db, enrich, worker

log = logging.getLogger("fern")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m fern", description="The Conservatory's worker.")
    parser.add_argument("--enrich", type=int, metavar="SPECIES_ID", help="re-run the enrichment pass for one species and exit")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s fern %(levelname)s %(message)s")
    data_dir = Path(os.environ.get("CONSERVATORY_DATA", "data"))
    db_path = Path(os.environ.get("CONSERVATORY_DB", data_dir / "conservatory.db"))

    if args.enrich is not None:
        conn = db.connect(db_path)
        try:
            log.info("%s", enrich.enrich_species(conn, data_dir, args.enrich))
        except Exception as exc:  # noqa: BLE001  (a hand run reports and exits non-zero)
            log.error("enrich species %d FAILED: %s: %s", args.enrich, type(exc).__name__, exc)
            return 1
        finally:
            conn.close()
        return 0

    api_key = os.environ.get("PLANTNET_API_KEY", "").strip()
    if not api_key:
        log.error("PLANTNET_API_KEY is not set; nothing to identify with")
        return 2
    (data_dir / "photos").mkdir(parents=True, exist_ok=True)
    (data_dir / enrich.REFERENCE_DIR).mkdir(parents=True, exist_ok=True)

    conn = db.connect(db_path)
    log.info("up: db=%s schema=v%d queued=%d", db_path, db.current_version(conn), db.queued_jobs(conn))

    running = True

    def stop(signum, _frame):
        nonlocal running
        log.info("stopping on signal %d", signum)
        running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    worker.run_forever(conn, data_dir, api_key, lambda: running)
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
