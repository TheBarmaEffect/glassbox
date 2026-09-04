import importlib, pkgutil, json, traceback
out = {}
try:
    import guardrails
    out["version"] = getattr(guardrails, "__version__", "?")
except Exception as e:
    out["import_error"] = repr(e); print(json.dumps(out, indent=2)); raise SystemExit
# What validators are bundled in-package (no hub download)?
try:
    from guardrails import validators as V
    names = [n for n in dir(V) if n[0].isupper()]
    out["bundled_validator_symbols"] = names
except Exception as e:
    out["validators_import_error"] = repr(e)
# Is there a hub namespace already populated?
try:
    import guardrails.hub as H
    out["hub_path"] = list(getattr(H, "__path__", []))
    out["hub_contents"] = sorted([m.name for m in pkgutil.iter_modules(H.__path__)]) if hasattr(H,"__path__") else []
except Exception as e:
    out["hub_error"] = repr(e)
print(json.dumps(out, indent=2, default=str))
