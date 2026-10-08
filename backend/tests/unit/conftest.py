"""
Test setup: a throw-away SQLite database and media folder, set before the app is imported.

MediaPipe is only needed for real photo analysis. If it cannot be imported (e.g. a numpy version clash),
a stand-in module is used so the rest of the app can be tested; tests that need it are skipped.
"""
import os
import sys
import tempfile
import types

_tmp = tempfile.mkdtemp(prefix="salon_tests_")
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_tmp, "test.db").replace("\\", "/")
os.environ["STORAGE_LOCAL_DIR"] = os.path.join(_tmp, "media")
os.environ["APP_ENV"] = "development"
os.environ["GEMINI_API_KEY"] = ""

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

try:
    import mediapipe  # noqa: F401
    MEDIAPIPE_AVAILABLE = True
except Exception:
    MEDIAPIPE_AVAILABLE = False
    for name in [m for m in sys.modules if m.startswith("mediapipe")]:
        del sys.modules[name]
    mp = types.ModuleType("mediapipe")
    mp.Image = object
    mp.ImageFormat = types.SimpleNamespace(SRGB=1)
    tasks = types.ModuleType("mediapipe.tasks")
    py = types.ModuleType("mediapipe.tasks.python")
    py.BaseOptions = object
    py.vision = types.SimpleNamespace()
    mp.tasks, tasks.python = tasks, py
    sys.modules.update({"mediapipe": mp, "mediapipe.tasks": tasks, "mediapipe.tasks.python": py,
                        "mediapipe.tasks.python.vision": py.vision})

import pytest  # noqa: E402


@pytest.fixture(scope="session")
def app_module():
    import app.main as main
    return main


@pytest.fixture()
def client(app_module):
    from fastapi.testclient import TestClient
    from app.core import auth
    auth._failures.clear()
    return TestClient(app_module.app)


@pytest.fixture()
def db(app_module):
    from app.core.database import SessionLocal
    with SessionLocal() as session:
        yield session
