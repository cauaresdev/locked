"""Daily step target for the routine (steps now come from the health store).

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | Sequence[str] | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("athletes") as batch_op:
        batch_op.add_column(sa.Column("steps_target", sa.Integer(), nullable=False, server_default="8000"))


def downgrade() -> None:
    with op.batch_alter_table("athletes") as batch_op:
        batch_op.drop_column("steps_target")
