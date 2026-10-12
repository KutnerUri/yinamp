# YouTube Music source lab

Developer-only investigation of YouTube Music's actual client requests,
collection commands, pagination, artwork and latency. Production does not import
this project. Keep the source and sanitized investigation findings in the repo;
generated reports and temporary profiles stay ignored.

Run from the repository root:

```sh
npm run prototype -- --auto                  # Bounded source investigation
npm run prototype                           # Interactive source lab
npm run prototype -- --auto --queries        # Also exercise client search categories
npm run prototype -- --auto --validate-production # Validate the production adapter
```

The production check measures all three catalogs, caching, Refresh and account
invalidation, and loads mix covers through the interface session. It does not
change the main app's playback queue.

The launcher snapshots Yinamp's encrypted app session into a temporary ignored
profile and deletes it when the prototype exits. The main app can stay running.
Sign in through Yinamp first. Node, Python 3 and the repository's Electron
dependency are required.

Do not inspect or export cookie values, authorization headers, full account
contexts or attestation bodies. Persist only sanitized catalog metadata and
request summaries. Continuation values are excluded from summaries; URL query
parameter names and presence are retained. Use returned commands, not translated
shelf titles or invented search terms, to investigate personalized presets.

Results are written under `reports/` and can be deleted after recording validated
findings. Automatic source runs have a 150-second internal deadline and a
180-second launcher cutoff. Separate real-account evidence from fixture checks;
provider feeds and opaque parameters can change between runs.

See [the recorded investigation](INVESTIGATION-2026-10-12.md) and
[production validation](../../LIBRARY-VALIDATION.md) for observations and limits.

The grouping experiment was discarded. Its metadata findings and UI takeaways
are retained in [the experiment notes](MIX-GROUPING.md); grouping code and the
preview server were removed. The main app retains the flat Mixes collection.
