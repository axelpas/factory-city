# docs/

| File / folder | Content | When to read it |
|---|---|---|
| `architecture.md` | Packages, boundaries, flows between analyzer and viewer | Before any change that crosses a package |
| `data-model.md` | Data contracts (snapshot, timeline, factory, facts, report, index) | Before changing a file format |
| `glossary.md` | Vocabulary: district, building, parcel, snapshot, frame, image, preset, marker... | When a term is not obvious |
| `decisions/` | ADRs: `YYYY-MM-DD-title.md`, about 10 lines (context, decision, consequences) | Before reopening a debate |
| `modules/<package>.md` | One file per package | Before touching the package |
| `audits/` | Dated audit reports | In periodic reviews |
| `archive/YYYY/` | Replaced docs, with "Replaced by ..." at the top | Rarely |

Rules: a reference doc is not rewritten when facts change; the outdated section gets a dated box (what changed, where the truth lives). A doc has a single location. A replaced doc moves to `archive/`.
