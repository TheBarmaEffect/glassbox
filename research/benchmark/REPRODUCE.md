# Reproducing GBSA-1

No API key. No network. No paid backend. Runs in seconds.

```bash
cd platforms && npm ci && npm run build     # compile Lite
cd ../research/benchmark
python3 build_dataset.py                    # 112 items, seed 20260815
python3 build_heldout.py                    #  75 items, seed 20260816
node run_benchmark.mjs --repeat 3
node run_benchmark.mjs --dataset heldout.jsonl --repeat 3
python3 score.py                            # development split
python3 score.py heldout_results.jsonl      # held-out split
```

Both generators are seeded, so `dataset.jsonl` and `heldout.jsonl` regenerate
byte-identically. `--repeat 3` runs each suite three complete times and asserts
the passes are identical.

Report the **held-out** figures as the capability estimate. The development
split was used to locate defects and the implementation was repaired against it.
