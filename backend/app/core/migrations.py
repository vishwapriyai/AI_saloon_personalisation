"""
Schema creation and the lightweight "add missing columns" migration.

create_all() only creates missing tables; it never alters existing ones. add_missing_columns() adds columns that
exist on the ORM models but not yet in the database. Use Alembic for anything beyond adding columns (renames,
type changes, drops).

Development runs this automatically at startup. In production run it once before starting the workers, so
several workers never race on ALTER TABLE:

    cd backend
    python -m app.core.migrations
"""
from sqlalchemy import inspect, text

from app.core.database import Base, engine
import app.models.domain  # noqa: F401  (registers every table on Base.metadata)

COLUMN_DEFAULTS = {
    ("customers", "profile_label"): "'Self'",
    ("customers", "must_change_password"): "0",
    ("style_selections", "stylist_approved"): "1",
    ("customer_consents", "consent_third_party_ai"): "0",
}


def add_missing_columns() -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            present = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in present:
                    continue
                col_type = column.type.compile(dialect=engine.dialect)
                default = COLUMN_DEFAULTS.get((table.name, column.name))
                ddl = f"ALTER TABLE {table.name} ADD COLUMN {column.name} {col_type}"
                if default is not None:
                    ddl += f" DEFAULT {default}"
                conn.execute(text(ddl))
                print(f"[migrate] added column {table.name}.{column.name}", flush=True)


def migrate_database() -> None:
    Base.metadata.create_all(bind=engine)
    add_missing_columns()


if __name__ == "__main__":
    migrate_database()
    print("[migrate] database is up to date", flush=True)
