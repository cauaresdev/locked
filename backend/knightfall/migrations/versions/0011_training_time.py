"""Usual training time (training and pre-workout meal reminders).

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | Sequence[str] | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("athletes") as batch_op:
        batch_op.add_column(sa.Column("training_time", sa.String(length=5), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("athletes") as batch_op:
        batch_op.drop_column("training_time")
