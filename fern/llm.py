"""The language model behind the care sheet (#23): Claude through the Vercel
AI Gateway, the Aviary's route (its gateway_client.py is the model for this).

One POST, no SDK: the Anthropic Messages endpoint at the gateway's base URL,
a bearer token, a JSON body, urllib from the standard library, so Fern's venv
grows no dependency. The body is exactly four keys (model, max_tokens, system,
messages). No sampling settings, because current Claude models reject
non-default ones. No thinking settings, because thinking is always on at the
default effort, and its tokens count against max_tokens, so the ceiling is
roomy. Usage is logged per call so the bill is visible in Fern's journal.

Config (the environment file, read by both units):
    AI_GATEWAY_API_KEY   the gateway's key; unset means no care model, and
                         the care pass says so once at start and does nothing
    CONSERVATORY_LLM     the gateway model slug (dots in the version), default
                         DEFAULT_MODEL; the list is at
                         https://ai-gateway.vercel.sh/v1/models

Ollama is not wired: the owner chose the gateway alone for now (#23).
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass

log = logging.getLogger("fern")

GATEWAY_HOST = "ai-gateway.vercel.sh"
GATEWAY_URL = f"https://{GATEWAY_HOST}/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_MODEL = "anthropic/claude-sonnet-5.5"
TIMEOUT_S = 180
# Room for the model's thinking and a six-cell JSON answer. Thinking counts
# against this ceiling; the Aviary learned that a tight one buys a cut-off
# answer and a bill for nothing.
MAX_TOKENS = 16000

# What the journal says for a status, in the reader's words: each is a
# different thing to go and fix.
STATUS_WORDS = {
    400: "the gateway rejected the request",
    401: "the gateway refused the key (AI_GATEWAY_API_KEY)",
    402: "the gateway has no credits to bill",
    403: "the gateway key is not allowed to do this",
    404: "the gateway knows no such model (CONSERVATORY_LLM)",
    429: "the gateway rate-limited the request",
}


class LlmError(Exception):
    """The model wrote nothing usable. The message is the journal's words."""


@dataclass
class Config:
    key: str
    model: str


@dataclass
class Reply:
    text: str
    input_tokens: int | None
    output_tokens: int | None


def config(environ: Mapping[str, str] | None = None) -> Config | None:
    """The gateway key and model from the environment, or None when there is no key."""
    env = os.environ if environ is None else environ
    key = (env.get("AI_GATEWAY_API_KEY") or "").strip()
    if not key:
        return None
    return Config(key=key, model=(env.get("CONSERVATORY_LLM") or "").strip() or DEFAULT_MODEL)


def payload(system: str, prompt: str, model: str) -> dict:
    """Exactly what leaves the box: the instructions, the facts, the model, a ceiling."""
    return {"model": model, "max_tokens": MAX_TOKENS, "system": system, "messages": [{"role": "user", "content": prompt}]}


def parse_reply(body: object) -> Reply:
    """The answer's text blocks joined, or LlmError: a refusal, a cut-off (an
    answer truncated mid-JSON must never reach the validator as if whole), or
    no text at all."""
    if not isinstance(body, dict):
        raise LlmError("the gateway answered with something that is not a message")
    stop = body.get("stop_reason")
    if stop == "refusal":
        raise LlmError("the model declined to answer (stop_reason refusal)")
    if stop == "max_tokens":
        raise LlmError(f"the answer was cut off at {MAX_TOKENS} tokens (stop_reason max_tokens)")
    text = "".join(
        b.get("text") or "" for b in body.get("content") or [] if isinstance(b, dict) and b.get("type") == "text"
    ).strip()
    if not text:
        raise LlmError(f"the model answered without text (stop_reason {stop!r})")
    usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
    return Reply(text=text, input_tokens=usage.get("input_tokens"), output_tokens=usage.get("output_tokens"))


def status_line(code: int, detail: str = "") -> str:
    words = STATUS_WORDS.get(code) or ("the gateway answered a server error" if code >= 500 else "the gateway answered")
    return f"{words} ({code})" + (f": {detail}" if detail else "")


def complete(cfg: Config, system: str, prompt: str) -> Reply:
    """One blocking completion. Raises LlmError, never anything else."""
    req = urllib.request.Request(
        GATEWAY_URL,
        data=json.dumps(payload(system, prompt, cfg.model)).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg.key}",
            "anthropic-version": ANTHROPIC_VERSION,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            body = json.load(resp)
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = str(json.loads(e.read().decode("utf-8")).get("error", {}).get("message", ""))
        except Exception:  # noqa: BLE001  (the status is the message; the detail is a bonus)
            pass
        raise LlmError(status_line(e.code, detail[:200])) from None
    except Exception as e:  # noqa: BLE001  (unreachable, timed out, unreadable body)
        raise LlmError(f"{GATEWAY_HOST} unreachable ({type(e).__name__}: {e})") from None
    return parse_reply(body)
