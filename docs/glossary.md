# Glossary

- **District**: a folder, drawn as a low plinth; districts nest.
- **Building**: a file. Area (the ground it stands on), height, color and an optional marker come from metrics.
- **Parcel**: the fixed rectangle a file owns on the map for the whole timeline. It never moves; an absent file leaves an empty lot.
- **Snapshot**: the analysis of one revision (or of the files on disk), stored as a CodeCharta cc.json.
- **Frame**: one step of a timeline: a commit, an issue or a day. Each frame points to one snapshot.
- **Image**: one rendered picture. A timelapse shows many images per frame.
- **Preset**: a declarative set of channels (area, height, color, extra channel) that answers one question.
- **Marker**: optional pyramid roof on the files that are above a threshold on a chosen metric (by default the bound where the metric's risk dimension turns high). It replaced the twist of a building on 2026-11-15 (`decisions/2026-11-15-marker-replaces-twist.md`).
- **Data level**: what a source unlocks: 0 files, 1 git history, 2 forge (`gh`), 3 facts.
- **Collector**: an analyzer component that produces the metrics of one data level.
- **Facts**: what neither the code nor the forge knows (agent, model, outcome, cost), provided as a file.
- **Lens**: a view of frame metrics on the timeline bar (tick colors, markers, trend strip, frame card).
- **Hover card**: the information card shown when pointing at a building or district.
- **Risk profile**: per dimension, the share of code (by `rloc`) in low, moderate, high and very high risk files.
- **Retrospective metric**: a metric that tells what later happened to a frame's code; labeled, and never changes the city drawn for that frame.
- **Hotspot**: a file where complexity meets recent change (or size, without git).
- **Rework**: lines deleted or rewritten while less than 14 days old.
- **Unavailable**: a value that cannot be computed; shown as "n/a" with its reason, never as zero.
