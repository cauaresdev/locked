"""Alembic environment.

Used both from the CLI (`alembic -c alembic.ini upgrade head`, URL from
KNIGHTFALL_DATABASE_URL) and programmatically by Database.migrate(), which
passes an open connection through config.attributes.
"""

import os

from alembic import context
from sqlalchemy import create_engine, text

from knightfall.db import DEFAULT_URL, Base

config = context.config
target_metadata = Base.metadata

# Arbitrary app-wide key: every API worker migrates on startup, and on Postgres
# this lock makes them take turns instead of racing on the same DDL.
MIGRATION_LOCK_KEY = 0x4B4E4654  # "KNFT"


def run_offline() -> None:
    context.configure(
        url=os.environ.get("KNIGHTFALL_DATABASE_URL", DEFAULT_URL),
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        _run(connection)
        return
    engine = create_engine(os.environ.get("KNIGHTFALL_DATABASE_URL", DEFAULT_URL))
    with engine.begin() as conn:
        _run(conn)


def _run(connection) -> None:
    if connection.dialect.name == "postgresql":
        # Released when the surrounding transaction commits.
        connection.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": MIGRATION_LOCK_KEY})
    # render_as_batch lets future ALTERs work on SQLite too.
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_offline()
else:
    run_online()
