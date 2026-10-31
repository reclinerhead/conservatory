"""Run Fern: `python -m fern`.

Phase 1 scaffold: opens the database, applies the schema, and idles, logging
the queue depth. The identification loop lands with the queue issue (#6).

Environment:
    CONSERVATORY_DB     path to the SQLite file (default data/conservatory.db)
    CONSERVATORY_DATA   directory for photos (default data/)
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import time
from pathlib import Path

from . import db

log = logging.getLogger("fern")


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s fern %(levelname)s %(message)s")
    data_dir = Path(os.environ.get("CONSERVATORY_DATA", "data"))
    db_path = Path(os.environ.get("CONSERVATORY_DB", data_dir / "conservatory.db"))
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

    last = -1
    while running:
        n = db.queued_jobs(conn)
        if n != last:
            log.info("queue: %d waiting (identification arrives with #6)", n)
            last = n
        time.sleep(5)

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
