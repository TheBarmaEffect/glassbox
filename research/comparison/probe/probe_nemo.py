import json
out={}
try:
    import nemoguardrails
    out["version"]=getattr(nemoguardrails,"__version__","?")
except Exception as e:
    out["import_error"]=repr(e); print(json.dumps(out,indent=2)); raise SystemExit
# Which library actions exist that do NOT need an LLM?
try:
    from nemoguardrails.library.jailbreak_detection import actions as jb
    out["jailbreak_actions"]=[n for n in dir(jb) if not n.startswith("_")]
except Exception as e: out["jb_err"]=repr(e)
try:
    from nemoguardrails.library.jailbreak_detection import heuristics as jbh
    out["jailbreak_heuristics_mod"]=[n for n in dir(jbh) if not n.startswith("_")]
except Exception as e: out["jbh_err"]=repr(e)
try:
    import nemoguardrails.library as lib, pkgutil
    out["library_modules"]=sorted([m.name for m in pkgutil.iter_modules(lib.__path__)])
except Exception as e: out["lib_err"]=repr(e)
print(json.dumps(out,indent=2,default=str))
