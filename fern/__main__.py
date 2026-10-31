"""Run Fern: `python -m fern`.

Opens the database, applies the schema, and drains the identification queue
against Pl@ntNet until stopped.

Environment:
    CONSERVATORY_DB     path to the SQLite file (default data/conservatory.db)
    CONSERVATORY_DATA   directory for photos (default data/)
    PLANTNET_API_KEY    the Pl@ntNet key; Fern refuses to start without it
"""

from __future__ import annotations

import logging
import os
import signal
import sys
from pathlib import Path

from . import db, worker

log = logging.getLogger("fern")


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s fern %(levelname)s %(message)s")
    data_dir = Path(os.environ.get("CONSERVATORY_DATA", "data"))
    db_path = Path(os.environ.get("CONSERVATORY_DB", data_dir / "conservatory.db"))
    api_key = os.environ.get("PLANTNET_API_KEY", "").strip()
    if not api_key:
        log.error("PLANTNET_API_KEY is not set; nothing to identify with")
        return 2
    (data_dir / "photos").mkdir(parents=True, exist_ok=True)

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
