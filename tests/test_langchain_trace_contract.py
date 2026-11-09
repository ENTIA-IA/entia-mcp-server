"""Fail-closed contract for the public LangChain MCP example.

The demo must never infer BUILD entitlement merely because a key exists.
These static tests do not require LangChain or network access.
"""
import ast
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "examples" / "langchain_agent.py"


def _main():
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    return next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "main")


def test_trace_allowlist_is_unconditional():
    main = _main()
    assignments = [n for n in main.body if isinstance(n, ast.Assign)]
    allowed = [n for n in assignments if any(isinstance(t, ast.Name) and t.id == "allowed" for t in n.targets)]
    assert len(allowed) == 1, "TRACE allowlist must be unconditional, even with an API key"
    assert isinstance(allowed[0].value, ast.Call)
    assert isinstance(allowed[0].value.func, ast.Name)
    assert allowed[0].value.func.id == "trace_tool_names"


def test_agent_receives_filtered_tools():
    main = _main()
    assignments = [n for n in main.body if isinstance(n, ast.Assign)]
    filtered = [n for n in assignments if any(isinstance(t, ast.Name) and t.id == "tools" for t in n.targets) and isinstance(n.value, ast.ListComp)]
    assert filtered, "Agent example must filter tools before constructing the agent"
    assert any(
        isinstance(node, ast.Compare)
        and isinstance(node.left, ast.Attribute)
        and node.left.attr == "name"
        and any(isinstance(op, ast.In) for op in node.ops)
        and any(isinstance(comp, ast.Name) and comp.id == "allowed" for comp in node.comparators)
        for assignment in filtered for node in ast.walk(assignment.value)
    ), "Filter must constrain exposed tool names to TRACE allowlist"
