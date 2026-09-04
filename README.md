# Telemetry snapshots

Periodic captures of `GET /api/v1/metrics` from the deployed GlassBox gateway.

This branch exists because the counters are in-memory and the free Render
instance sleeps after roughly fifteen minutes idle, taking the counts with it.
Each line is one observation of the totals as served at that moment.

**These are not continuous traffic figures, and must not be reported as such.**
A snapshot covers whatever the instance had accumulated since it last woke.
Requests served and lost between snapshots are not represented, so the series is
a lower bound on volume, not a measurement of it. `reachable: false` lines record
the instance being unavailable, which is a deployment observation in its own
right rather than a gap to be quietly dropped.

Content is aggregate-only by construction: the endpoint publishes counts,
distributions and latency buckets, never submitted content.
