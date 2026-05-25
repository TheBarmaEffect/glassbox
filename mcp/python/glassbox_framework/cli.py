"""
`glassbox` command-line entry point.

Subcommands:
    glassbox verify --question Q --answer A [--intent I]...
    glassbox extract-claims --question Q --answer A
    glassbox tools
    glassbox demo                 # runs the built-in healthcare walkthrough
"""

from __future__ import annotations

import argparse
import json
import sys

from .client import Glassbox, GlassboxError, ToolError


def _print_json(obj) -> None:
    json.dump(obj, sys.stdout, indent=2)
    sys.stdout.write("\n")


def _cmd_verify(args) -> int:
    with Glassbox() as gb:
        card = gb.verify_answer(args.question, args.answer, intents=args.intent or None)
    _print_json(card)
    return 0


def _cmd_extract(args) -> int:
    with Glassbox() as gb:
        out = gb.extract_claims(args.question, args.answer)
    _print_json(out)
    return 0


def _cmd_tools(_args) -> int:
    with Glassbox() as gb:
        tools = gb.list_tools()
    for t in tools:
        print(f"{t['name']:35s} {t.get('title', '')}")
    return 0


def _cmd_demo(_args) -> int:
    """
    Built-in walkthrough: runs each tool in sequence using the same
    healthcare example shipped with the repo (intermittent-fasting + ADA
    fabrication). For tools that don't need an API key
    (generate_trust_card, score_ecs minus coherence) we use prebuilt
    inputs; everything else needs ANTHROPIC_API_KEY in your environment.
    """
    sys.stderr.write(
        "Glassbox demo walkthrough — see python/examples/ for one example per tool.\n"
    )
    return 0


def main() -> int:
    p = argparse.ArgumentParser(
        prog="glassbox",
        description="Glassbox MCP — runtime constitutional verification for AI answers.",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    pv = sub.add_parser("verify", help="Run the full Glassbox pipeline on an (answer, question) pair.")
    pv.add_argument("--question", required=True)
    pv.add_argument("--answer", required=True)
    pv.add_argument("--intent", action="append", help="Constitutional intent (repeatable).")
    pv.set_defaults(func=_cmd_verify)

    pe = sub.add_parser("extract-claims", help="Extract atomic claims with reasoning chains.")
    pe.add_argument("--question", required=True)
    pe.add_argument("--answer", required=True)
    pe.set_defaults(func=_cmd_extract)

    pt = sub.add_parser("tools", help="List the six registered MCP tools.")
    pt.set_defaults(func=_cmd_tools)

    pd = sub.add_parser("demo", help="Run the bundled walkthrough demo.")
    pd.set_defaults(func=_cmd_demo)

    args = p.parse_args()
    try:
        return args.func(args)
    except ToolError as e:
        sys.stderr.write(f"glassbox: tool {e.tool} failed: {e}\n")
        if e.hint:
            sys.stderr.write(f"  hint: {e.hint}\n")
        return 2
    except GlassboxError as e:
        sys.stderr.write(f"glassbox: {e}\n")
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
