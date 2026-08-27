# Page performance baseline

Recorded 2026-08-27 with Bun 1.4.0 on the local development host.

```sh
bun run benchmark:pages -- --users=500 --posts=2500 --miss=10 --warm=50
```

The benchmark disables proactive feed warming and models an established signed-in account with one recent unread page.
Page-cache misses use unique harmless variants within one process, retaining reusable post fragments. Results therefore
model normal production invalidation, not an empty first-boot process.

| Identity | Page | Miss p50 | Miss p95 | Warm p50 | Warm p95 | Warm cache |
|---|---:|---:|---:|---:|---:|---|
| anonymous | latest | 271.69 ms | 513.11 ms | 3.01 ms | 4.79 ms | memory |
| anonymous | hot | 27.11 ms | 43.79 ms | 2.83 ms | 3.78 ms | memory |
| anonymous | profile | 14.45 ms | 32.00 ms | 11.80 ms | 15.50 ms | none |
| anonymous | post | 287.74 ms | 294.86 ms | 2.59 ms | 4.24 ms | memory |
| anonymous | explore | 15.63 ms | 20.10 ms | 13.99 ms | 18.58 ms | none |
| signed-in | latest | 556.91 ms | 1025.49 ms | 9.32 ms | 14.95 ms | memory |
| signed-in | for-you | 554.56 ms | 1178.18 ms | 11.80 ms | 33.32 ms | memory |
| signed-in | to-me | 40.26 ms | 204.75 ms | 10.79 ms | 17.54 ms | memory |
| signed-in | hot | 76.58 ms | 304.45 ms | 8.74 ms | 13.48 ms | memory |
| signed-in | profile | 25.12 ms | 37.70 ms | 20.93 ms | 31.01 ms | none |
| signed-in | post | 525.97 ms | 610.99 ms | 5.09 ms | 9.16 ms | memory |
| signed-in | explore | 36.03 ms | 59.20 ms | 29.16 ms | 55.29 ms | none |

Compare future changes using the same command, dataset, sample counts, machine, and idle-system conditions. Treat small
differences as noise; prioritize repeatable changes to medians and tail latency.
