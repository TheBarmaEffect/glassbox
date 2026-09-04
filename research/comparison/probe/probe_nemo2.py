import json, inspect
out={}
for mod in ["regex","injection_detection"]:
    try:
        m=__import__(f"nemoguardrails.library.{mod}.actions", fromlist=["actions"])
        fns=[n for n,o in vars(m).items() if callable(o) and not n.startswith("_") and getattr(o,"action_meta",None) is not None]
        allf=[n for n,o in vars(m).items() if inspect.isfunction(o) and not n.startswith("_")]
        out[mod]={"actions_with_meta":fns,"functions":allf}
        for n in allf:
            try: out[mod].setdefault("sigs",{})[n]=str(inspect.signature(getattr(m,n)))
            except Exception: pass
    except Exception as e:
        out[mod]={"err":repr(e)}
print(json.dumps(out,indent=2,default=str))
