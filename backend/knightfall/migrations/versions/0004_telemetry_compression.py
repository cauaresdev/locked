"""Compress telemetry older than 7 days (TimescaleDB only).

1 Hz heart rate is ~86k rows per athlete per day of wear. Recent chunks stay
row-oriented for fast inserts and Early Bird checks; older ones are
compressed per athlete and kind, which typically cuts their size by 90 %+
while keeping every sample queryable.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _hypertable(bind) -> bool:
    if bind.dialect.name != "postgresql":
        return False
    return bool(bind.execute(sa.text(
        "SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'"
    )).scalar())


def upgrade() -> None:
    if not _hypertable(op.get_bind()):
        return
    op.execute(
        "ALTER TABLE telemetry_samples SET (timescaledb.compress, "
        "timescaledb.compress_segmentby = 'athlete_id, kind', timescaledb.compress_orderby = 'ts')"
    )
    op.execute("SELECT add_compression_policy('telemetry_samples', INTERVAL '7 days', if_not_exists => TRUE)")


def downgrade() -> None:
    if not _hypertable(op.get_bind()):
        return
    op.execute("SELECT remove_compression_policy('telemetry_samples', if_exists => TRUE)")
