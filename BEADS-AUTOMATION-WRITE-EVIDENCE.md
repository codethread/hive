# Latest-value automation storage probe

Installed br 0.7.6; four disposable native trackers, explicit paths and actor; 20 sequential updates per fixture. Native auto-export and subprocess output capture were included. This is a bounded storage experiment, not a throughput guarantee or checkpoint-lock benchmark. No CAS read/lock cycle, contention, network or production-sized tracker was measured.

| Initial description payload | Update mode | Final JSONL bytes | Comments | Audit events / text bytes | Median write ms (range) | SQLite file bytes |
| --- | --- | ---: | ---: | --- | --- | ---: |
| 16 KiB | Append observation comments | 20,616 | 20 | 22 / 1,583 | 48.0 (45.9–51.9) | 356,352 |
| 16 KiB | Replace latest member in description JSON | 16,838 | 0 | 2 / 53 | 46.7 (43.8–49.6) | 356,352 |
| 256 KiB | Append observation comments | 266,377 | 20 | 22 / 1,583 | 54.8 (51.2–57.5) | 847,872 |
| 256 KiB | Replace latest member in description JSON | 262,599 | 0 | 2 / 53 | 54.8 (52.4–57.4) | 847,872 |

The latest-only representation removed about 3.8 KB of accumulated comment/record overhead after 20 small observations. The source payload dominated final size in the larger fixture. No per-description-edit audit entries appeared in this experiment; do not claim native audit captured each previous JSON value. Database allocated sizes were identical within each pair. Current JSONL, live rows, SQLite allocation, native backup generations and Git history are distinct storage layers.

Both modes cost roughly the same per write at these sizes. This does not establish scaling for a large workflow ledger or repeated acquisition/release CAS writes. The proposal should preserve no-op suppression, coalesce activity updates, expose only required latest values, and include a separate locked multi-writer/large-ledger benchmark in implementation acceptance. Ordinary native backup/Git history can still retain prior exported values; this probe did not prune or measure those stores.

Full receipts/paths: BEADS-AUTOMATION-WRITE-EXPERIMENT.json. Repeatable fixture: BEADS-AUTOMATION-WRITE-EXPERIMENT.py. All SQL inspection was read-only against disposable databases; native br performed every mutation.
