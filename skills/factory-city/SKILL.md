---
name: factory-city
description: "Analyze the current project with Factory City and show it as a 3D city: runs the analysis (a snapshot, or the timeline of the history), reads the code-health report, summarizes the score, the risks and the hotspots, then serves the city locally to look at. Read-only on the project. Use when the user asks for the health of a codebase, its hotspots, a code city, or how its quality evolves."
---

# Factory City

Factory City turns a codebase into a 3D city: folders are districts, files are buildings. It reads the project and never changes it. This skill runs it, reads the result, tells the user what matters, and opens the city.

## 1. Find the command

Look in this order, and stop at the first hit:

1. `factory-city` is on the PATH: use it.
2. The environment variable `FACTORY_CITY_CLI` holds the path of `packages/analyzer/dist/cli/main.js`: run `node "$FACTORY_CITY_CLI"` wherever this skill says `factory-city`.
3. A clone already exists in a usual place. Check these paths one by one with `test -f` (never `find` over the home folder, it is slow): `~/GIT/factory-city`, `~/factory-city`, `~/src/factory-city`, `~/code/factory-city`, `~/dev/factory-city`, each followed by `/packages/analyzer/dist/cli/main.js`. If one exists, use it with `node` and tell the user the one-line fix below so that the next session finds it at once.
4. Otherwise stop and give the user the lines below, then wait. Do not install anything yourself.

```sh
git clone https://github.com/axelpas/factory-city.git && cd factory-city
pnpm install && pnpm build
export FACTORY_CITY_CLI="$(pwd)/packages/analyzer/dist/cli/main.js"
```

To make it permanent for Claude Code, the user can put the `export` line in `~/.zshenv`, or the variable in the `env` section of `~/.claude/settings.json`, or link `factory-city` into a folder of the PATH (for example `~/.local/bin`). These are the user's own files: propose them, do not edit them unasked.

It needs Node.js 22 or later. Git and the GitHub CLI (`gh`) are optional: each unlocks a richer data level.

## 2. Choose what to analyze

- **Snapshot** (default): the files as they are now. Fast. No history.
- **Timeline**: the history as frames, one per issue (`--by issue`), per day (`--by day`) or per commit (`--by commit`). Use it when the user asks how quality evolves, or wants the timelapse. A very large repository needs `--max-frames 100` and, for one module, `--path <folder>`.
- Leave out what is not the project's own code with `--exclude "<glob>"` (repeatable), for example a prototypes folder the user names.
- Add `--offline` when `gh` is not signed in or the user asks for no network.

If the user did not say which one, take the snapshot and offer the timeline afterwards.

## 3. Run it, with the output outside the project

The output must never land in the analyzed project, and never in a public repository. Run from the user's home folder or any neutral folder, and let the tool write to its default place, `~/.factory-city/<name>`, or give an explicit `-o` folder that is not inside any repository.

```sh
cd ~
factory-city analyze <project> [--exclude "<glob>"]                    # snapshot
factory-city timeline <project> --by issue [--offline] [--max-frames N]  # history
```

The last lines say where the data was written. Remember that folder as `<data>`.

## 4. Read the report and summarize

```sh
factory-city report <data> --json
```

`report` takes a **data folder written by `analyze` or `timeline`, or a project folder**. For a data folder it reads the `report*.json` already there, and it fails or prints nothing useful if there is none. For a project folder it analyzes the project first. It has no `--rev`: to look at another revision, analyze that revision first (`analyze --rev <rev>`), then read its data folder.

Never redirect the output of `report` into the data folder: it would overwrite the report file that was just read. To keep the text, write it to another folder, such as the session's scratch folder.

Tell the user, in a few lines and in their language:

- the **score in percent**, with the sentence that it is a heuristic: the share of code in files that are low risk on every static dimension, meaningful against the same project's past, not across projects;
- the **dimensions that pull it down**: from `health.profile`, the ones with the largest share at high or very high;
- the **top five hotspots**: path, size, worst function complexity, number of cohesion groups, recent commits, and the first suggested action;
- the **data level** (0 files, 1 history, 2 GitHub, 3 facts) and anything marked unavailable, said as unavailable, never as zero;
- for a timeline, how the score moved from the first frame to the last.

Do not quote source code. The report holds paths, metrics and declaration names only.

## 5. Open the city

```sh
factory-city view <data> --no-open
```

Run it in the background. Do not pass `--port`: the tool takes a free one and prints `Factory City is running at http://127.0.0.1:<port>/`. Give the user that address. For a timeline, the playback bar at the bottom plays the history; the right panel has the Health tab (score, risk profile, hotspots) and the Factory tab (KPIs per period).

Say that the server is running, and stop it when the user is done (`pkill -f "view .*<data>"`). Never leave one running without telling them.

## Rules

- **Read-only on the project.** Do not edit, check out, or write anything into the analyzed folder.
- **Keep results out of git.** Do not commit the data folder, pictures or GIFs, and do not paste figures into issues, pull requests or release notes unless the user asks.
- **Private projects stay private.** Do not export pictures, films or standalone pages (`render`) of a project the user has not said may be shown. If asked, use `--redact`.
- **One result at a time.** If the analysis fails, report the message as it is, and the one fix it names. Do not retry with other flags in a loop.
