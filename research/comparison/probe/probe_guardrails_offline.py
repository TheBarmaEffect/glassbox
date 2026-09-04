"""Can the Guardrails AI *engine* run offline with a locally-authored validator?
And does it attempt network at runtime?"""
import json, socket
attempts = []
_real = socket.getaddrinfo
def spy(host, *a, **k):
    attempts.append(host)
    return _real(host, *a, **k)
socket.getaddrinfo = spy

out = {}
try:
    from guardrails import Guard
    from guardrails.validators import Validator, PassResult, FailResult, register_validator

    @register_validator(name="local/has-definitely", data_type="string")
    class HasDefinitely(Validator):
        def validate(self, value, metadata):
            return FailResult(error_message="found") if "definitely" in value.lower() else PassResult()

    g = Guard().use(HasDefinitely(on_fail="noop"))
    r1 = g.validate("This is definitely true.")
    r2 = g.validate("Paris is the capital of France.")
    out["engine_runs_offline"] = True
    out["flagged_positive"] = not r1.validation_passed
    out["flagged_negative"] = not r2.validation_passed
except Exception as e:
    out["engine_runs_offline"] = False
    out["error"] = repr(e)[:300]
out["network_hosts_attempted"] = sorted(set(attempts))
print(json.dumps(out, indent=2))
