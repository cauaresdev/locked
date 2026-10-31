"""Body measurements and the nutrition goal (cut / maintain / bulk).

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "body_measurements",
        sa.Column("athlete_id", sa.String(length=36), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("site", sa.String(length=16), nullable=False),
        sa.Column("cm", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("athlete_id", "day", "site"),
    )
    with op.batch_alter_table("athletes") as batch_op:
        batch_op.add_column(sa.Column("nutrition_goal", sa.String(length=8), nullable=False, server_default="cut"))


def downgrade() -> None:
    with op.batch_alter_table("athletes") as batch_op:
        batch_op.drop_column("nutrition_goal")
    op.drop_table("body_measurements")
