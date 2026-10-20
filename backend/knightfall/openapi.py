"""Print the API's OpenAPI schema (the mobile app generates its types from it).

    python -m knightfall.openapi > ../mobile/src/api/openapi.json
"""

from __future__ import annotations

import json
import sys

from .api import create_app
from .db import Database


def main() -> None:
    app = create_app(Database("sqlite://"))  # in-memory: building the schema touches no data
    json.dump(app.openapi(), sys.stdout, indent=2, sort_keys=True, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
