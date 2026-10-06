import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn

from app.core.config import settings
from app.core.database import engine, Base
from app.api.v1.endpoints import router as api_v1_router
from app.models.domain import *  # Ensure all ORM models are registered for table creation

# Create database tables automatically
Base.metadata.create_all(bind=engine)

# Auto-migrate: add columns that exist on the ORM models but not yet in the database tables.
# create_all() only creates missing tables; it never alters existing ones. Use Alembic for anything
# beyond adding columns (renames, type changes, drops).
COLUMN_DEFAULTS = {
    ("customers", "profile_label"): "'Self'",
    ("style_selections", "stylist_approved"): "1",
}


def add_missing_columns() -> None:
    from sqlalchemy import inspect, text

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


add_missing_columns()


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Salon AI & Customer Analytics Platform API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount local media directory for storage
media_dir = os.path.abspath(settings.STORAGE_LOCAL_DIR)
os.makedirs(media_dir, exist_ok=True)
app.mount("/static/media", StaticFiles(directory=media_dir), name="media")

# Register API routers
app.include_router(api_v1_router, prefix=settings.API_V1_STR)

@app.get("/")
def root_status():
    return {
        "status": "ONLINE",
        "system": settings.PROJECT_NAME,
        "docs": "/docs"
    }

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
