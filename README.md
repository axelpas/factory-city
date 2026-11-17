# Factory City

**Turn a codebase into a 3D city, to see what a software factory builds, how its quality evolves and what its process leaves behind.**

![The city of this repository, played from its first issue to the last: folders are districts, files are buildings, and the code-health score is at the top right.](docs/assets/timelapse.gif)

Folders are districts, files are buildings. Code metrics drive each building's ground area, height and color, and a pyramid roof marks the files that cross a threshold. The name comes from the "software factory": software produced by AI coding agents under human direction. Factory City is not affiliated with any company named Factory.

It is two independent programs that share nothing but data files: an **analyzer** (a command line) and a **viewer** (a static web app). It works on a plain folder, and gets richer with git, then with GitHub, then with an optional facts file.

- **Local first.** No backend, no database, no telemetry, no upload. The only network use is optional: `gh` calls for issue and CI metadata, and the dependency audit you ask for with `--with audit` (`--offline` turns both off).
- **Read-only.** It never checks out, modifies or writes into the code it analyzes. Its output holds paths, metrics, git and issue metadata, never source code.
- **Honest.** A value that cannot be computed is stored and shown as unavailable, never as zero.
- **Installs with Node alone.** Pure JavaScript and WebAssembly, no native build at install time.

[Open the standalone demo](examples/factory-city.html) (one file, works offline) · [Watch the film](examples/factory-city.mp4) · [The same on a public project](examples/twenty-ui.html) ([about the examples](examples/README.md))

## Quickstart

You need Node.js 22 or later and pnpm. Git and the GitHub CLI are optional: each one unlocks a [data level](#data-levels).

```sh
git clone https://github.com/axelpas/factory-city.git
cd factory-city
pnpm install && pnpm build
alias factory-city="node $(pwd)/packages/analyzer/dist/cli/main.js"

cd ~/some/project
factory-city            # analyze the folder and open its city in the browser
```

With no argument, `factory-city` analyzes the current folder and opens the city. The first run needs no flag and no configuration file. Output goes to `~/.factory-city/<project>/`.

To play a project's history as a timelapse:

```sh
factory-city timeline . --by issue     # one frame per issue (or --by commit, --by day)
factory-city view                      # serve the viewer and open it
```

## Use it from Claude Code

A skill in this repository lets Claude Code analyze the project you are working in, summarize its health and open its city. Copy it once:

```sh
mkdir -p ~/.claude/skills && cp -R skills/factory-city ~/.claude/skills/
export FACTORY_CITY_CLI="$(pwd)/packages/analyzer/dist/cli/main.js"   # if `factory-city` is not on your PATH
```

Then ask Claude Code for the health of your codebase, its hotspots, or its code city. The skill only reads the project: the data goes to `~/.factory-city/`.

## How to read the city

- **A building is a file, a plinth is a folder.** The ground a building takes shows how much code it holds; its height shows how complex it is; its color shows the metric you chose.
- **The Indicator picker** at the top chooses a preset: all three channels at once, each stating the question it answers ("Where is complex code changing often?").
- **Roofs.** On a preset with a marker (Three Cs), a file above the threshold wears a pyramid roof; the steeper the roof, the further above the threshold.
- **Point at a building** for its card, **click it** for all its metrics, its history and its issues. Drag to orbit, scroll to zoom. `?` lists the keyboard shortcuts.
- **A value in n/a** could not be computed for that file. It is never shown as zero.

![The card of a building: its mapped metrics, where it stands in the city and its last change.](docs/assets/hover-card.png)

## A tour

### Presets

Every preset keeps ground area = real lines and height = complexity, so the skyline stays familiar and only the color changes its meaning.

| Group | Preset | Question |
|---|---|---|
| Code | Structure, Cohesion, Three Cs, Shortcuts, Security signals, Duplication | Where is the code large, complex and entangled? Which files do several jobs? Where were checks silenced? Where does the code widen the attack surface? |
| History | Hotspots, Bug magnets, Risky and moving, Waste, Contention | Where is complex code changing often? Where do fixes keep landing? Where do security signals sit in code that keeps changing? Where is fresh code thrown away? |
| Factory | Agents, Cost | Who wrote what? Where does the money go? |
| Compare | Change | What did this step do to the city? |

### Four themes

The same data, the same legend, four looks. Two are sober, one is made of blocks, one is futuristic. A theme is one token file; adding one touches no code.

| | |
|---|---|
| ![Architect's Model: off-white ground, white buildings, soft shadows.](docs/assets/theme-architect.png) | ![Isometric Plan: orthographic camera, flat fills, thin outlines.](docs/assets/theme-isometric.png) |
| ![Blocks: buildings as stacks of cubes on a grid.](docs/assets/theme-blocks.png) | ![Hologram: luminous outlines on a dark background.](docs/assets/theme-hologram.png) |

### The timelapse

A timeline is a list of frames: a commit, an issue or a day. Every file keeps the same parcel, so nothing moves on the map. A file that does not exist yet, or no longer does, leaves an empty lot. Between two frames every building is interpolated on the GPU, so it is an animation, never a slideshow.

![The timelapse of this repository, one frame per issue: buildings grow and shrink in place, empty lots wait for files that do not exist yet.](docs/assets/timelapse.gif)

[Watch it as a film](examples/factory-city.mp4) (MP4, 960×540)

The same, on one module of a public project (the MIT-licensed `packages/twenty-ui` of [twentyhq/twenty](https://github.com/twentyhq/twenty), pinned to the tag `twenty/v2.58.0`):

![The twenty-ui module, from the first issue to the last of its history, one frame per issue.](docs/assets/twenty-ui-timelapse.gif)

### Health, and the factory

The right-hand panel is always there. Folded, it shows the code-health score (as a percentage), its trend over the frames and the three kinds of risk that weigh most; the score follows the playhead and its change turns green or red. Unfolded, its tabs show the full risk profile and the hotspots, the selected file, and the factory KPIs.

![The Health tab: score, trend, risk profile and hotspots.](docs/assets/panel-health.png)
![The Factory tab: throughput, fix share, rework and the issues to look at.](docs/assets/panel-factory.png)

The score is a heuristic: the share of code in files that are low risk on every static dimension. It is meaningful against the same project's past, not across projects. KPIs are questions to ask about the process, not targets, and never a ranking of people.

### Compare a branch with its base

```sh
factory-city diff . main HEAD --image diff.png
```

![What a branch did to the city: buildings added, grown, shrunk and removed, on a diverging ramp.](docs/assets/diff.png)

### Exports

- **Image:** a PNG of the current view at 1x, 2x or 4K, with or without a title, the frame, the score and the legend.
- **Video:** the timelapse rendered offline, image by image, on a virtual clock (never a screen recording), at the speed you choose. MP4 when the browser can encode H.264, else WebM.
- **Standalone HTML:** one self-contained file with the full interactive city. `--redact` removes commit subjects, issue titles, author labels and declaration names.

```sh
factory-city render --image city.png --size 1920x1080 --preset three-cs --theme blocks
factory-city render --video film.mp4 --seconds-per-frame 0.5
factory-city render --html city.html --redact
```

Images and videos need the optional `playwright-core` and a Chrome or Chromium on the machine. The core install never downloads a browser.

## Supported languages

Any text file gets a building; how much is measured depends on the language. `factory-city languages` prints the list.

| Tier | Languages | What is measured |
|---|---|---|
| 1 | TypeScript, TSX, JavaScript, Python, Go, Java | Size, complexity, nesting, coupling, cohesion, the full set of shortcuts (silenced checks) and security signals |
| 2 | C#, C, C++, Rust, PHP, Ruby, Kotlin, Swift | Size, complexity, nesting and some shortcuts. Coupling, cohesion and security signals are unavailable for now. |
| 3 | Any other text file, with `--all` | Lines and the git metrics only |

A metric a language does not have is shown as unavailable, never as zero. The git metrics (change, fixes, rework, authorship) work for every language. Adding a language is a grammar and one JSON file: see [Extending it](#extending-it).

## Data levels

Each level only adds; nothing above level 0 is required. `factory-city doctor` says which level you have reached and the one action that unlocks the next.

| Level | Needs | Unlocks |
|---|---|---|
| 0 Files | a folder | size, complexity, coupling, cohesion, shortcuts, duplication; the Code presets; the code-health report and score |
| 1 History | a git repository | change, fixes, rework, contention, authorship; timelapse per commit, day and issue number; diff; the KPIs git alone can answer |
| 2 Forge | `gh`, signed in, on a GitHub repository | issue titles, kinds and estimates, pull requests, CI attempts, cycle time |
| 3 Facts | a facts file | agent and model per issue, outcome, review findings, rework rounds, minutes, cost |

A shallow clone gives a truncated level 1: the tool warns and says how to fetch the full history.

## Command line

```
factory-city [path]                 analyze a folder and open its city (the default)
factory-city analyze  [path]        [--rev <rev>] [--dirty] [--path <dir>] [--all] [--include/--exclude <glob>] [--with duplication] [--sarif <file>] [--with audit] [--offline] [-o <dir>]
factory-city timeline [repo]        --by commit|issue|day [--branch] [--since] [--until] [--range A..B] [--revs a,b] [--max-frames N] [--facts <file>] [--offline]
factory-city diff     [repo] [base] [head]   [--image out.png] [--json]
factory-city report   [path]        the code-health report, in Markdown or --json
factory-city view     [dataDir]     serve the viewer [--port <n>] [--no-open]
factory-city render   [dataDir]     --image | --video | --html  [--source] [--preset] [--theme] [--size WxH] [--frame N] [--fps 30|60] [--seconds-per-frame S] [--redact]
factory-city metrics | languages | doctor
```

With no configuration, the city shows engineering work only: dependency and build folders, assets, lockfiles, minified and generated files are left out, `.gitignore` is respected, tests are kept and flagged. One line says what was left out and why; `--all` includes everything. An optional `factory-city.config.json` holds globs, issue and fix patterns, author labels, the facts mapping, the windows and the thresholds. Every command accepts `--json` where it prints a result.

## Data format

The analyzer writes plain files and the viewer reads them; they share nothing else.

- `snapshot.cc.json`: one snapshot per frame, valid for [CodeCharta](https://codecharta.com)'s `cc.json` schema, so it also opens in its Web Studio. Attributes are numeric; a category is an integer code whose labels live in the manifest; an unavailable value is left out.
- `analysis.json` and `timeline.<mode>.json`: the manifest (data level, metric registry, ignored files, issue coverage, ordered frames with their metrics and scores).
- `report.json` and `factory.json`: the code-health report and the factory KPIs.
- `dependencies.json`: known vulnerabilities of the lockfile, only when `--with audit` was asked for (per project, not per file, not in the score).

The contracts are described in [`docs/data-model.md`](docs/data-model.md) and validated by JSON Schema in both programs.

## Extending it

- **A language:** one grammar, one JSON file (`packages/analyzer/src/languages/<id>.json`: which syntax nodes count as functions, branches, comments, shortcuts), one fixture. No language-specific code. Steps in [`docs/modules/analyzer.md`](docs/modules/analyzer.md#how-to-add-a-language).
- **A metric:** declare it in the registry (`packages/schema/src/registry.ts`: definition, computation, why it matters, unit, direction, data level, limits). The viewer builds its pickers and its help from the registry.
- **A preset:** a JSON file in `packages/viewer/src/presets/` naming the area, height, color and optional marker, and the question it answers.
- **A theme:** a token file in `packages/viewer/src/themes/` (palette, ramps, light, camera, renderer `solid`, `voxel` or `wireframe`). No literal color or font anywhere else.
- **A facts mapping:** in `factory-city.config.json`, under `facts`: `columns` (field to header name or position), `filter`, `values` (raw value to a known outcome) and `attempts`.

## FAQ

**Does anything leave my machine?** No. Nothing is uploaded and there is no telemetry. With `gh` signed in, the tool reads issue, pull request and CI metadata from GitHub; `--offline` turns that off. The one other exception is `--with audit`, which you must ask for: it sends the **names and versions of the packages in your lockfile** (nothing else, no path, no code, no project name) to [api.osv.dev](https://osv.dev), then the ids of the advisories that matched, and prints what it sends before it sends it. `--offline` refuses it. Source code never appears in the output.

**How is the score computed?** The share of code (by real lines) in files that are low risk on every static dimension available for them: file size, complexity, nesting, coupling, cohesion, shortcuts, duplication. History dimensions stay out, so the score does not depend on how much history exists. Thresholds are listed in the report with their source, or marked "project default, not a standard".

**What does "unavailable" mean?** The value could not be computed for that file or at that data level. It is stored and shown as n/a, never as zero, and the help says why.

**Why are KPIs not targets?** They are questions to ask about a process. Each one shows its sample size and stays unavailable under five issues. They never rank people.

## Contributing

Everything is in English: code, identifiers, commits, issues and docs. Typecheck, lint and tests are green before an issue is closed; tests are written with the code, from the acceptance criteria. Commits read `type(scope): description (#n)`, one issue per change, and the history is the changelog (there is no changelog file). Decisions that shape the project (a dependency, a data contract, an algorithm, a threshold) get a short record in [`docs/decisions/`](docs/decisions/). No `any`, no `@ts-ignore`, no stray `console.log`.

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm licenses:check     # every dependency must be MIT, ISC, BSD, Apache-2.0, 0BSD, Unlicense, CC0 or MPL-2.0
pnpm docs:assets        # regenerates the pictures of this page and the files of examples/
```

## Prior art and credits

Factory City stands on published work: [CodeCharta](https://codecharta.com) (the `cc.json` format), VERSO (Langelier, Sahraoui and Poulin, 2005: height = complexity, color = coupling, twist = cohesion), CodeCity (Wettel and Lanza), the history-resistant layout of M3triCity (Pfahler et al., 2020), CodeMetropolis (a code city as a block world), hotspot analysis (complexity combined with change frequency), LCOM4 (Hitz and Montazeri) and LCOM5 (Henderson-Sellers) for cohesion, the package metrics of Abdeen, Ducasse and Sahraoui, the SZZ approach (Sliwerski, Zimmermann, Zeller) for bug origins, two-week code churn as a rework signal, and the DORA delivery metrics. The code is original; no code is copied from these projects. Third-party dependencies are listed in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

## License

[MIT](LICENSE). Factory City is not affiliated with any company named Factory.
