"""Gemini / Vertex AI: temporary errors are retried on Gemini before the fallback provider is used."""
import asyncio
from types import SimpleNamespace

import pytest
from google.genai import errors, types

import app.ai.image_editing as ie
from app.ai.errors import ImageEditError
from app.core.config import settings


def _image():
    part = SimpleNamespace(inline_data=SimpleNamespace(data=b"jpeg"))
    cand = SimpleNamespace(content=SimpleNamespace(parts=[part]), finish_reason=types.FinishReason.STOP)
    return SimpleNamespace(candidates=[cand], usage_metadata=None, prompt_feedback=None)


def _no_image(reason=types.FinishReason.STOP):
    part = SimpleNamespace(inline_data=None, text="Here is your edited photo.")
    cand = SimpleNamespace(content=SimpleNamespace(parts=[part]), finish_reason=reason)
    return SimpleNamespace(candidates=[cand], usage_metadata=None, prompt_feedback=None)


def _error(code, status):
    cls = errors.ServerError if code >= 500 else errors.ClientError
    return cls(code, {"error": {"code": code, "message": status.lower(), "status": status}})


class _FakeClient:
    """Answers each request with the next scripted outcome; records what was sent."""

    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.requests = []
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self._generate))

    async def _generate(self, model, contents, config):
        self.requests.append({"contents": contents, "modalities": list(config.response_modalities)})
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def _editor(*clients):
    editor = object.__new__(ie.GeminiEditor)
    editor._is_vertex = len(clients) == 1
    editor._project = "test-project"
    editor._clients = list(clients)
    editor._keys = [f"key-{i}-abcdefghijkl" for i in range(len(clients))]
    editor._key_counter = 0
    return editor


@pytest.fixture
def waits(monkeypatch):
    slept = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr(ie.asyncio, "sleep", fake_sleep)
    return slept


def _run(editor):
    return asyncio.run(editor.edit_image("fast", "prompt", b"photo", None, usage={}))


@pytest.mark.parametrize("code,status", [(429, "RESOURCE_EXHAUSTED"), (503, "UNAVAILABLE"), (500, "INTERNAL"),
                                         (504, "DEADLINE_EXCEEDED")])
def test_temporary_vertex_errors_are_retried_with_a_wait(code, status, waits):
    client = _FakeClient([_error(code, status), _error(code, status), _image()])
    assert _run(_editor(client)) == b"jpeg"
    assert len(client.requests) == 3 and waits == settings.GEMINI_RETRY_WAITS_SECONDS[:2]


def test_text_only_answer_is_retried_asking_for_the_image_only(waits):
    client = _FakeClient([_no_image(), _image()])
    assert _run(_editor(client)) == b"jpeg"
    assert client.requests[0]["modalities"] == ["TEXT", "IMAGE"] and client.requests[1]["modalities"] == ["IMAGE"]
    assert waits == []  # no need to wait: the service answered


def test_safety_block_is_retried_once_with_context_then_reported(waits):
    client = _FakeClient([_no_image(types.FinishReason.IMAGE_SAFETY), _image()])
    assert _run(_editor(client)) == b"jpeg"
    assert ie.SAFETY_CONTEXT in client.requests[1]["contents"]

    blocked = _FakeClient([_no_image(types.FinishReason.IMAGE_SAFETY)] * 2)
    with pytest.raises(ImageEditError, match="safety filter"):
        _run(_editor(blocked))
    assert len(blocked.requests) == 2


def test_permanent_errors_are_not_retried(waits):
    client = _FakeClient([_error(403, "PERMISSION_DENIED")])
    with pytest.raises(ImageEditError, match="403"):
        _run(_editor(client))
    assert len(client.requests) == 1 and waits == []


def test_gives_up_after_the_request_limit(waits):
    client = _FakeClient([_error(429, "RESOURCE_EXHAUSTED")] * settings.GEMINI_MAX_REQUESTS)
    with pytest.raises(ImageEditError, match="429"):
        _run(_editor(client))
    assert len(client.requests) == settings.GEMINI_MAX_REQUESTS


def test_api_key_pool_tries_another_key_before_waiting(waits):
    first, second = _FakeClient([_error(429, "RESOURCE_EXHAUSTED")]), _FakeClient([_image()])
    assert _run(_editor(first, second)) == b"jpeg"
    assert waits == []


def test_retry_budget_fits_inside_the_attempt_timeout():
    assert settings.GEMINI_RETRY_BUDGET_SECONDS < settings.GENERATION_TIMEOUT_SECONDS
