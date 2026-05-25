### What this PR does

<!-- One paragraph. -->

### Why

<!-- One paragraph. The motivation, the use case, or the bug being fixed. Link issues if relevant: closes #123 -->

### How to verify

<!-- The exact commands a reviewer should run to convince themselves this works. Minimum:

```bash
cd mcp
npx tsc --noEmit            # TypeScript strict-mode compile
node demo/launch-demo.mjs --fast   # MCP smoke test
# If you changed Python code:
cd python && python -m build
```

If your change touches an engine, include the before/after Trust Card on the bundled healthcare example (`demo/raw-inputs.json`). The canonical audit log_id is `glassbox-85cc09903bd4b3f8022a4087` — any change to the engines, the verdict policy, or the ECS arithmetic SHOULD change this hash; any change that ISN'T to those parts MUST NOT.
-->

### Checklist

- [ ] TypeScript strict-mode passes (`cd mcp && npx tsc --noEmit`)
- [ ] Python wheel builds (`cd mcp/python && python -m build`) if Python changed
- [ ] At least one demo example runs end-to-end against my branch
- [ ] If I changed an engine, the audit log_id either intentionally changed (documented) or is the canonical reference
- [ ] README / DISTRIBUTION.md updated if I added a public-surface change

### Architectural commitments (do not violate without an issue first)

- The reasoning chain on every claim is **non-negotiable**. If you find a code path that emits an empty reasoning field, that's a bug.
- The ECS formula must be **rendered visibly in the output** along with the dimension values. No opaque score totals.
- Audit `log_id`s must be deterministic over canonicalised JSON. Timestamps never enter the hash.
- Server-side input validation lives in Zod (TypeScript). Python client stays thin.

### Anything else
