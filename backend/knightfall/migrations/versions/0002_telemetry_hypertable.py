"""TimescaleDB hypertable for telemetry (Postgres with the extension only).

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-15
"""

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timescale_available(bind) -> bool:
    # KNIGHTFALL_TIMESCALE=off keeps a plain table even where the extension is listed (managed Postgres
    # such as Neon ships a reduced build; the app never needs TimescaleDB to work).
    if bind.dialect.name != "postgresql" or os.environ.get("KNIGHTFALL_TIMESCALE", "").lower() == "off":
        return False
    return bool(bind.execute(sa.text(
        "SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'"
    )).scalar())


def upgrade() -> None:
    bind = op.get_bind()
    if not _timescale_available(bind):
        return  # plain table on SQLite / vanilla Postgres
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
    op.execute(
        "SELECT create_hypertable('telemetry_samples', 'ts', "
        "chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE)"
    )


def downgrade() -> None:
    pass  # a hypertable cannot be converted back in place; dropping 0001 removes it
