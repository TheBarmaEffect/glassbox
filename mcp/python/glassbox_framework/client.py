"""
Glassbox MCP client — spawns the Node server and talks JSON-RPC over stdio.

Design notes:

- Zero third-party dependencies. The official Anthropic `mcp` Python SDK
  is the obvious shortcut, but it has its own transitive dependency tree
  that's heavier than we need. The MCP JSON-RPC framing is simple enough
  to implement directly, and it keeps `pip install glassbox-framework`
  to a pure-Python stdlib install.

- The Node server is spawned lazily on first use and torn down by the
  context manager or `close()`. Each tool call gets a unique JSON-RPC id
  and waits on a per-id Future-like primitive backed by a reader thread.

- Tools that have non-trivial input shapes (verify, score_ecs,
  generate_trust_card) are exposed as ordinary keyword-argument methods.
  The MCP server already validates everything with Zod, so we keep the
  client thin and let server-side errors surface as ToolError.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
from typing import Any, Optional

__all__ = ["Glassbox", "GlassboxError", "ToolError"]


class GlassboxError(RuntimeError):
    """Raised when the client cannot reach or initialise the MCP server."""


class ToolError(RuntimeError):
    """Raised when a tool call returns isError=True."""

    def __init__(self, tool: str, message: str, hint: Optional[str] = None):
        super().__init__(message)
        self.tool = tool
        self.hint = hint


def _default_server_command() -> list[str]:
    """
    Resolve how to launch the Glassbox MCP server.

    Resolution order:
      1. GLASSBOX_SERVER_CMD env var (whitespace-split shell command)
      2. Local checkout: ts-node alongside the python package
      3. Fall back to `npx -y @glassbox-framework/mcp` (assumes npm-published version)
    """
    env_cmd = os.environ.get("GLASSBOX_SERVER_CMD")
    if env_cmd:
        return env_cmd.split()

    # Look for a sibling local checkout (../src/index.ts relative to the
    # installed Python package or the source tree).
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "..", "..", "src", "index.ts"),
        os.path.join(here, "..", "src", "index.ts"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            ts_node = shutil.which("ts-node") or shutil.which("npx")
            if ts_node:
                if ts_node.endswith("npx"):
                    return [ts_node, "ts-node", os.path.abspath(c)]
                return [ts_node, os.path.abspath(c)]

    # Published-package fallback.
    npx = shutil.which("npx")
    if npx:
        return [npx, "-y", "@glassbox-framework/mcp"]

    raise GlassboxError(
        "Could not find a Glassbox MCP server to launch. "
        "Either install Node + run `npm install @glassbox-framework/mcp`, "
        "or point GLASSBOX_SERVER_CMD at the server launch command."
    )


class Glassbox:
    """
    Glassbox MCP client.

    The recommended usage is as a context manager:

        with Glassbox() as gb:
            card = gb.verify_answer(question="...", answer="...")

    The server subprocess is started on `__enter__` (or on first tool call
    if you don't use `with`), and torn down on `__exit__` / `close()`.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        server_command: Optional[list[str]] = None,
        timeout: float = 120.0,
    ) -> None:
        """
        Args:
            api_key: Anthropic API key. If None, the ANTHROPIC_API_KEY env
                var is used. Tools that don't make LLM calls
                (generate_trust_card, score_ecs) work without a key.
            model: override the verification model. Defaults to the server's
                GLASSBOX_MODEL env var, which defaults to claude-sonnet-4-6.
            server_command: list of strings for the subprocess. If None,
                auto-detect (see _default_server_command).
            timeout: per-tool-call timeout in seconds.
        """
        self._api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        self._model = model
        self._cmd = server_command or _default_server_command()
        self._timeout = timeout

        self._proc: Optional[subprocess.Popen[bytes]] = None
        self._reader_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._next_id = 1
        self._pending: dict[int, dict[str, Any]] = {}
        self._pending_events: dict[int, threading.Event] = {}
        self._initialised = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def __enter__(self) -> "Glassbox":
        self._ensure_running()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def close(self) -> None:
        proc = self._proc
        if proc is None:
            return
        try:
            proc.stdin.close()  # type: ignore[union-attr]
        except Exception:
            pass
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        self._proc = None

    def _ensure_running(self) -> None:
        if self._proc is not None and self._proc.poll() is None:
            return
        env = os.environ.copy()
        if self._api_key:
            env["ANTHROPIC_API_KEY"] = self._api_key
        if self._model:
            env["GLASSBOX_MODEL"] = self._model

        try:
            self._proc = subprocess.Popen(
                self._cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                bufsize=0,
            )
        except FileNotFoundError as e:
            raise GlassboxError(
                f"Failed to launch Glassbox MCP server (command {self._cmd!r}): {e}. "
                "Install Node, or set GLASSBOX_SERVER_CMD to a working launcher."
            ) from e

        self._reader_thread = threading.Thread(
            target=self._reader_loop, daemon=True, name="glassbox-framework-reader"
        )
        self._reader_thread.start()

        # MCP handshake.
        self._send(
            {
                "jsonrpc": "2.0",
                "id": self._take_id(),
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "glassbox-framework-py", "version": "1.0.0"},
                },
            },
            wait=True,
        )
        self._send(
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            wait=False,
        )
        self._initialised = True

    # ------------------------------------------------------------------
    # JSON-RPC plumbing
    # ------------------------------------------------------------------

    def _take_id(self) -> int:
        with self._lock:
            i = self._next_id
            self._next_id += 1
            return i

    def _send(self, msg: dict, wait: bool) -> Optional[dict]:
        assert self._proc and self._proc.stdin
        data = (json.dumps(msg) + "\n").encode("utf-8")
        if not wait:
            self._proc.stdin.write(data)
            self._proc.stdin.flush()
            return None

        msg_id = msg["id"]
        evt = threading.Event()
        with self._lock:
            self._pending_events[msg_id] = evt
        self._proc.stdin.write(data)
        self._proc.stdin.flush()

        if not evt.wait(timeout=self._timeout):
            with self._lock:
                self._pending_events.pop(msg_id, None)
                self._pending.pop(msg_id, None)
            self._dump_stderr()
            raise GlassboxError(
                f"Timed out waiting for MCP response to message {msg_id} after {self._timeout}s. "
                "Check the server is reachable and the model isn't throttled."
            )
        with self._lock:
            return self._pending.pop(msg_id, None)

    def _dump_stderr(self) -> None:
        if not self._proc or not self._proc.stderr:
            return
        try:
            self._proc.stderr.flush()
        except Exception:
            pass

    def _reader_loop(self) -> None:
        assert self._proc and self._proc.stdout
        for raw in self._proc.stdout:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            mid = msg.get("id")
            if mid is None:
                continue
            with self._lock:
                self._pending[mid] = msg
                evt = self._pending_events.pop(mid, None)
            if evt:
                evt.set()

    # ------------------------------------------------------------------
    # Generic tool call
    # ------------------------------------------------------------------

    def _call_tool(self, name: str, arguments: dict) -> Any:
        self._ensure_running()
        resp = self._send(
            {
                "jsonrpc": "2.0",
                "id": self._take_id(),
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            },
            wait=True,
        )
        if resp is None:
            raise GlassboxError(f"No response for tool call {name!r}.")
        if "error" in resp:
            raise GlassboxError(f"MCP error on {name!r}: {resp['error']}")
        result = resp.get("result", {})

        content = result.get("content") or []
        if not content:
            return None
        text = content[0].get("text", "")
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as e:
            raise GlassboxError(
                f"Tool {name!r} returned non-JSON content: {text[:200]!r} ({e})"
            ) from e

        if result.get("isError"):
            tool = payload.get("tool", name)
            err = payload.get("error", "unknown error")
            hint = payload.get("hint")
            raise ToolError(tool, err, hint=hint)
        return payload

    # ------------------------------------------------------------------
    # Tools
    # ------------------------------------------------------------------

    def verify_answer(
        self,
        question: str,
        answer: str,
        intents: Optional[list[str]] = None,
    ) -> dict:
        """
        Full pipeline: claim extraction → constitution → red team → ECS → verdict.
        Returns a Trust Card.
        """
        args: dict = {"question": question, "answer": answer}
        if intents:
            args["intents"] = intents
        return self._call_tool("glassbox_verify_answer", args)

    def extract_claims(self, question: str, answer: str) -> dict:
        """
        Decompose the answer into atomic claims, each with a reasoning chain.
        Returns `{"claims": [...], "trace": {...}}`.
        """
        return self._call_tool(
            "glassbox_extract_claims",
            {"question": question, "answer": answer},
        )

    def score_ecs(
        self,
        claims: list[dict],
        red_team: Optional[dict] = None,
        constitution: Optional[dict] = None,
        weights: Optional[dict] = None,
        mode: Optional[str] = None,
    ) -> dict:
        """
        Compute ECS from prebuilt parts. Returns the full breakdown.
        Makes one Anthropic call for the coherence check; the rest is local.
        """
        args: dict = {"claims": claims}
        if red_team is not None:
            args["red_team"] = red_team
        if constitution is not None:
            args["constitution"] = constitution
        if weights is not None:
            args["weights"] = weights
        if mode is not None:
            args["mode"] = mode
        return self._call_tool("glassbox_score_ecs", args)

    def red_team(
        self,
        question: str,
        answer: str,
        claims: Optional[list[dict]] = None,
        constitution: Optional[dict] = None,
        intents: Optional[list[str]] = None,
    ) -> dict:
        """
        Run Glassbox Court — 7 adversarial probes. If `claims` is omitted
        they are auto-extracted; if `constitution` is omitted but `intents`
        is provided, they are compiled inline.
        """
        args: dict = {"question": question, "answer": answer}
        if claims is not None:
            args["claims"] = claims
        if constitution is not None:
            args["constitution"] = constitution
        if intents:
            args["intents"] = intents
        return self._call_tool("glassbox_red_team", args)

    def generate_trust_card(
        self,
        question: str,
        answer: str,
        claims: list[dict],
        red_team: dict,
        ecs: dict,
        constitution: Optional[dict] = None,
        intents: Optional[list[str]] = None,
    ) -> dict:
        """
        Assemble a Trust Card from prebuilt parts. NO Anthropic call — runs
        only the verdict policy and the deterministic audit hash.
        """
        args: dict = {
            "question": question,
            "answer": answer,
            "claims": claims,
            "red_team": red_team,
            "ecs": ecs,
        }
        if constitution is not None:
            args["constitution"] = constitution
        if intents:
            args["intents"] = intents
        return self._call_tool("glassbox_generate_trust_card", args)

    def export_audit_report(
        self,
        question: str,
        answer: str,
        intents: Optional[list[str]] = None,
    ) -> dict:
        """
        Full pipeline + full audit record (call trace, deterministic log_id).
        """
        args: dict = {"question": question, "answer": answer}
        if intents:
            args["intents"] = intents
        return self._call_tool("glassbox_export_audit_report", args)

    def list_tools(self) -> list[dict]:
        """List the six registered tools (handshake utility)."""
        self._ensure_running()
        resp = self._send(
            {
                "jsonrpc": "2.0",
                "id": self._take_id(),
                "method": "tools/list",
                "params": {},
            },
            wait=True,
        )
        return resp.get("result", {}).get("tools", []) if resp else []
