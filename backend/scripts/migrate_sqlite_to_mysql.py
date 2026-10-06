"""
Copy every table and row from the SQLite database (salon_ai.db) into MySQL.

    cd backend
    python scripts/migrate_sqlite_to_mysql.py "mysql+pymysql://USER:PASSWORD@127.0.0.1:3306/salon_ai_db"
    python scripts/migrate_sqlite_to_mysql.py            # uses DATABASE_URL from backend/.env when it is MySQL

    --replace   empty the MySQL tables first (use when re-running the migration)

What it does:
  1. Creates the MySQL database (utf8mb4) if it does not exist, and all tables from the app's models.
  2. Copies every row of every table, keeping the same ids so all links between tables stay intact.
  3. Fills `hairstyles` (and `beard_styles`) from the full style catalogue, keyed by catalogue id, so saved
     previews and selections point at real rows. The SQLite copy of these tables was out of date.
  4. Verifies row counts and reports any rows that reference a missing parent row.
The SQLite file is only read, never changed, so it stays as a backup.
"""
import argparse
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import Boolean, DateTime, Float, Integer, create_engine, func, inspect, select, text  # noqa: E402
from sqlalchemy.engine import URL, make_url  # noqa: E402

from app.core.database import Base  # noqa: E402
import app.models.domain  # noqa: E402,F401  (registers every table on Base.metadata)
from app.ai.style_catalogue import ALL_STYLES, BEARD_CATALOGUE  # noqa: E402

CATALOGUE_TABLES = {"hairstyles", "beard_styles"}
CHUNK = 500


def filler(column):
    """Value for a NOT NULL column that is empty in SQLite."""
    if column.default is not None and getattr(column.default, "is_scalar", False):
        return column.default.arg
    if isinstance(column.type, Boolean):
        return False
    if isinstance(column.type, (Integer, Float)):
        return 0
    if isinstance(column.type, DateTime):
        return None
    return ""


def clean(table, row):
    out = {}
    for name, value in row.items():
        column = table.c[name]
        if value is None and not column.nullable and not column.primary_key:
            value = filler(column)
        out[name] = value
    return out


def catalogue_rows(table):
    """hairstyles / beard_styles rows built from the style catalogue (id = catalogue id)."""
    styles = ALL_STYLES if table.name == "hairstyles" else BEARD_CATALOGUE
    rows = []
    for st in styles:
        values = {
            "id": st["id"],
            "style_code": st["style_code"],
            "name": st["name"],
            "category": st.get("category", ""),
            "suitable_face_shapes": ",".join(st.get("face_shapes", [])),
            "suitable_hair_types": ",".join(st.get("hair_types", [])),
            "suitable_hair_lengths": st.get("hair_length") or "",
            "suitable_hair_densities": ",".join(st.get("recommended_hair_densities", [])),
            "gender": st.get("gender"),
            "maintenance_level": st.get("maintenance_level") or "",
            "description": st.get("description", ""),
            "stylist_instructions": st.get("stylist_instructions", ""),
            "preview_image_url": st.get("preview_image_url") or "",
            "requires_chemical_service": bool(st.get("requires_chemical_service")),
            "chemical_service_name": st.get("chemical_service_name"),
            "chemical_formula_instructions": st.get("chemical_formula_instructions"),
            "side_image_url": st.get("side_image_url"),
            "back_image_url": st.get("back_image_url"),
        }
        rows.append(clean(table, {k: v for k, v in values.items() if k in table.c}))
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mysql_url", nargs="?", default=None,
                    help='e.g. "mysql+pymysql://user:password@127.0.0.1:3306/salon_ai_db" (default: DATABASE_URL in .env)')
    ap.add_argument("--sqlite", default=os.path.join(os.path.dirname(__file__), "..", "salon_ai.db"))
    ap.add_argument("--replace", action="store_true", help="empty the MySQL tables before copying")
    args = ap.parse_args()

    if not args.mysql_url:
        from app.core.config import settings
        args.mysql_url = settings.DATABASE_URL
    url = make_url(args.mysql_url)
    if not url.drivername.startswith("mysql"):
        sys.exit("The target URL must be a MySQL URL (mysql+pymysql://...)")
    if not url.database:
        sys.exit("Add the database name to the URL, e.g. .../salon_ai_db")
    sqlite_path = os.path.abspath(args.sqlite)
    if not os.path.isfile(sqlite_path):
        sys.exit(f"SQLite database not found: {sqlite_path}")

    # 1. Database and tables
    server_url = URL.create(url.drivername, username=url.username, password=url.password,
                            host=url.host, port=url.port, query=url.query)  # no database: it may not exist yet
    server = create_engine(server_url)
    with server.begin() as conn:
        conn.execute(text(f"CREATE DATABASE IF NOT EXISTS `{url.database}` "
                          "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"))
    server.dispose()
    target = create_engine(url, pool_pre_ping=True)
    Base.metadata.create_all(target)
    source = create_engine(f"sqlite:///{sqlite_path}")
    source_tables = set(inspect(source).get_table_names())
    tables = Base.metadata.sorted_tables  # parents before children

    with target.connect() as conn:
        non_empty = [t.name for t in tables if conn.execute(select(t).limit(1)).first() is not None]
    if non_empty and not args.replace:
        sys.exit(f"MySQL already has data in: {', '.join(non_empty)}. Re-run with --replace to overwrite it.")

    # 2-3. Copy rows (foreign key checks off during the load; ids are kept)
    report = []
    with target.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
        if args.replace:
            for t in reversed(tables):
                conn.execute(t.delete())
        for t in tables:
            if t.name in CATALOGUE_TABLES:
                rows = catalogue_rows(t)
                note = "filled from the style catalogue"
                src_count = None
            elif t.name in source_tables:
                src_cols = {c["name"] for c in inspect(source).get_columns(t.name)}
                cols = [c for c in t.columns if c.name in src_cols]
                with source.connect() as sconn:
                    rows = [clean(t, dict(r._mapping)) for r in sconn.execute(select(*cols))]
                src_count = len(rows)
                missing = [c.name for c in t.columns if c.name not in src_cols]
                note = f"new columns left empty: {', '.join(missing)}" if missing else ""
            else:
                rows, src_count, note = [], 0, "not in SQLite (created empty)"
            for i in range(0, len(rows), CHUNK):
                conn.execute(t.insert(), rows[i:i + CHUNK])
            report.append((t.name, src_count, len(rows), note))
        conn.execute(text("SET FOREIGN_KEY_CHECKS = 1"))

    # 4. Verify counts and links
    print(f"\n{'table':<26}{'sqlite':>8}{'mysql':>8}  note")
    problems = 0
    with target.connect() as conn:
        for name, src_count, copied, note in report:
            t = Base.metadata.tables[name]
            mysql_count = conn.execute(select(func.count()).select_from(t)).scalar()
            ok = src_count is None or mysql_count == src_count
            problems += 0 if ok else 1
            print(f"{name:<26}{'-' if src_count is None else src_count:>8}{mysql_count:>8}  "
                  f"{'' if ok else 'COUNT MISMATCH  '}{note}")

        orphans = defaultdict(int)
        for t in tables:
            for fk in t.foreign_keys:
                parent = fk.column.table
                q = text(f"SELECT COUNT(*) FROM `{t.name}` c WHERE c.`{fk.parent.name}` IS NOT NULL AND NOT EXISTS "
                         f"(SELECT 1 FROM `{parent.name}` p WHERE p.`{fk.column.name}` = c.`{fk.parent.name}`)")
                n = conn.execute(q).scalar()
                if n:
                    orphans[f"{t.name}.{fk.parent.name} -> {parent.name}"] = n
    if orphans:
        print("\nRows pointing at a missing parent row (copied as-is; review if needed):")
        for k, n in orphans.items():
            print(f"  {k}: {n} row(s)")

    print("\nMigration " + ("finished." if not problems else f"finished with {problems} count mismatch(es)."))
    print("To switch the app to MySQL, set this in backend/.env and restart the backend:")
    print(f"  DATABASE_URL={url.render_as_string(hide_password=True).replace('***', '<your password>')}")


if __name__ == "__main__":
    main()
