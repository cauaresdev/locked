"""Composite (athlete, day) indexes for the per-day queries on set logs and food entries.

Every hot query filters by athlete and day together; the single-column indexes on the
day alone span all athletes, and the athlete-only ones are the composite's prefix.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-18
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_set_logs_athlete_day", "set_logs", ["athlete_id", "performed_on"])
    op.drop_index("ix_set_logs_athlete_id", table_name="set_logs")
    op.drop_index("ix_set_logs_performed_on", table_name="set_logs")
    op.create_index("ix_food_entries_athlete_day", "food_entries", ["athlete_id", "day"])
    op.drop_index("ix_food_entries_athlete_id", table_name="food_entries")
    op.drop_index("ix_food_entries_day", table_name="food_entries")


def downgrade() -> None:
    op.create_index("ix_food_entries_day", "food_entries", ["day"])
    op.create_index("ix_food_entries_athlete_id", "food_entries", ["athlete_id"])
    op.drop_index("ix_food_entries_athlete_day", table_name="food_entries")
    op.create_index("ix_set_logs_performed_on", "set_logs", ["performed_on"])
    op.create_index("ix_set_logs_athlete_id", "set_logs", ["athlete_id"])
    op.drop_index("ix_set_logs_athlete_day", table_name="set_logs")
