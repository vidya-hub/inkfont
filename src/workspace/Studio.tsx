import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  MousePointer2,
  PenTool,
  Brush,
  Eraser,
  Hand,
  Square,
  Circle,
  Undo2,
  Redo2,
  Download,
  FolderOpen,
  Upload,
  ScanLine,
  Spline,
  HelpCircle,
} from "lucide-react";
import { useDocument, initialize, flushSave } from "../core/store";
import { useEditor, type Tool } from "./editorState";
import { makeGlyph } from "../core/model";
import { pathData, resolveObjects } from "../core/geometry";
import { EditorCanvas } from "./Canvas";
import { Properties } from "./Properties";
import { Proof } from "./Proof";
import { Offline } from "./Offline";
import { Modal } from "./Modal";
import { runJob } from "../core/jobs";
import { download } from "../core/repository";
const Projects = lazy(() =>
  import("./ProjectDialog").then((m) => ({ default: m.ProjectDialog })),
);
const Import = lazy(() =>
  import("./ImportDialog").then((m) => ({ default: m.ImportDialog })),
);
const Worksheet = lazy(() =>
  import("./WorksheetDialog").then((m) => ({ default: m.WorksheetDialog })),
);
const tools: { id: Tool; name: string; key: string; icon: typeof Brush }[] = [
  { id: "select", name: "Select", key: "V", icon: MousePointer2 },
  { id: "node", name: "Nodes", key: "A", icon: Spline },
  { id: "bezier", name: "Bézier", key: "P", icon: PenTool },
  { id: "brush", name: "Brush", key: "B", icon: Brush },
  { id: "eraser", name: "Eraser", key: "E", icon: Eraser },
  { id: "rectangle", name: "Rectangle", key: "R", icon: Square },
  { id: "ellipse", name: "Ellipse", key: "O", icon: Circle },
  { id: "hand", name: "Hand", key: "H", icon: Hand },
];
export default function Studio() {
  const p = useDocument((s) => s.project),
    ready = useDocument((s) => s.ready),
    selected = useDocument((s) => s.selected),
    select = useDocument((s) => s.select),
    status = useDocument((s) => s.status),
    error = useDocument((s) => s.error),
    edit = useDocument((s) => s.edit),
    past = useDocument((s) => s.past),
    future = useDocument((s) => s.future),
    e = useEditor(),
    [dialog, setDialog] = useState<
      "projects" | "import" | "worksheet" | "export" | "help" | null
    >(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [custom, setCustom] = useState(""),
    [start, setStart] = useState(0),
    [panel, setPanel] = useState<"glyphs" | "properties" | null>(null),
    [exportError, setExportError] = useState(""),
    [exportBusy, setExportBusy] = useState(false),
    [exported, setExported] = useState(false),
    [findings, setFindings] = useState<
      { glyphId?: string; message: string; severity: string }[]
    >([]);
  useEffect(() => {
    void initialize();
    const hide = () => {
      if (document.visibilityState === "hidden") void flushSave();
    };
    document.addEventListener("visibilitychange", hide);
    const unload = (event: BeforeUnloadEvent) => {
      if (
        useDocument.getState().status === "saving" ||
        useDocument.getState().status === "error"
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  const glyphs = useMemo(
    () =>
      Object.values(p.glyphs)
        .sort((a, b) => {
          const rank = (name: string) => {
            const cp = name.codePointAt(0) ?? 0;
            return name.length > 2
              ? 100000
              : cp === 32
                ? 0
                : cp >= 65 && cp <= 90
                  ? cp
                  : cp >= 97 && cp <= 122
                    ? 100 + cp
                    : cp >= 48 && cp <= 57
                      ? 300 + cp
                      : 1000 + cp;
          };
          return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
        })
        .filter(
          (g) =>
            (!search ||
              g.name
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase())) &&
            (filter !== "missing" ||
              (!g.objects.length && !g.components.length)) &&
            (filter !== "complete" || g.objects.length || g.components.length),
        ),
    [p.glyphs, search, filter],
  );
  const count = Object.values(p.glyphs).filter(
    (g) => g.objects.length || g.components.length,
  ).length;
  const openExport = async () => {
    setExportError("");
    setExported(false);
    setDialog("export");
    const { inspectFont } = await import("../core/font");
    setFindings(inspectFont(p));
  };
  const addCustom = () => {
    if (!custom) return;
    edit("Add characters", (p) => {
      const glyphs = { ...p.glyphs },
        mappings = { ...p.mappings };
      for (const ch of Array.from(custom))
        if (!mappings[ch]) {
          const g = makeGlyph(ch);
          glyphs[g.id] = g;
          mappings[ch] = g.id;
        }
      return { ...p, glyphs, mappings };
    });
    setCustom("");
    setSearch("");
    setFilter("all");
  };
  if (!ready) return <div className="loading">Opening your local studio…</div>;
  return (
    <div className="inkfont-app">
      <Offline />
      <header className="app-header">
        <a
          className="wordmark"
          href="#"
          onClick={(ev) => {
            ev.preventDefault();
            setDialog("projects");
          }}
        >
          <span className="brand-mark">i</span>inkfont
          <span className="beta">STUDIO</span>
        </a>
        <input
          aria-label="Font name"
          className="project-name"
          value={p.name}
          maxLength={100}
          onChange={(ev) =>
            edit("Rename project", (p) => ({ ...p, name: ev.target.value }))
          }
        />
        <span className={"save-state " + status} role="status">
          {status === "saved"
            ? "● Saved on this device"
            : status === "saving"
              ? "◌ Saving…"
              : "! Save failed"}
        </span>
        <nav>
          <button onClick={() => setDialog("projects")}>
            <FolderOpen size={16} />
            Projects
          </button>
          <button onClick={() => setDialog("import")}>
            <Upload size={16} />
            Import
          </button>
          <button onClick={() => setDialog("worksheet")}>
            <ScanLine size={16} />
            Worksheet
          </button>
          <button className="primary" onClick={() => void openExport()}>
            <Download size={16} />
            Export font
          </button>
        </nav>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => setDialog("projects")}>Project backups</button>
          <button onClick={() => void flushSave()}>Retry save</button>
        </div>
      )}
      <div className="mobile-tabs">
        <button onClick={() => setPanel(panel === "glyphs" ? null : "glyphs")}>
          Glyphs
        </button>
        <button
          onClick={() => setPanel(panel === "properties" ? null : "properties")}
        >
          Properties
        </button>
      </div>
      <div className="studio-layout">
        <aside
          className={
            "glyph-browser " + (panel === "glyphs" ? "mobile-open" : "")
          }
        >
          <div className="panel-heading">
            <span>YOUR GLYPHS</span>
            <span>
              {count}/{Object.keys(p.glyphs).length}
            </span>
          </div>
          <input
            aria-label="Find glyph"
            placeholder="Find a character…"
            value={search}
            onChange={(ev) => {
              setSearch(ev.target.value);
              setStart(0);
            }}
          />
          <select
            aria-label="Glyph filter"
            value={filter}
            onChange={(ev) => {
              setFilter(ev.target.value);
              setStart(0);
            }}
          >
            <option value="all">All glyphs</option>
            <option value="missing">Unfinished</option>
            <option value="complete">With outlines</option>
          </select>
          <div className="glyph-list">
            {glyphs.slice(start, start + 120).map((g) => (
              <button
                key={g.id}
                aria-label={"Edit " + (g.name === " " ? "space" : g.name)}
                aria-pressed={g.id === selected}
                className={g.id === selected ? "selected" : ""}
                onClick={() => {
                  select(g.id);
                  setPanel(null);
                }}
              >
                <svg viewBox="-80 -850 1100 1150" aria-hidden>
                  {g.objects.length || g.components.length ? (
                    <path
                      d={resolveObjects(p, g.id)
                        .flatMap((o) => o.contours)
                        .map(pathData)
                        .join(" ")}
                      fill="currentColor"
                    />
                  ) : (
                    <text
                      x="450"
                      y="-100"
                      textAnchor="middle"
                      fontSize="620"
                      fill="currentColor"
                      opacity=".25"
                    >
                      {g.name === " " ? "␣" : g.name}
                    </text>
                  )}
                </svg>
                <span>{g.name === " " ? "space" : g.name}</span>
              </button>
            ))}
          </div>
          {glyphs.length > 120 && (
            <div className="button-row">
              <button
                disabled={start === 0}
                onClick={() => setStart(Math.max(0, start - 120))}
              >
                Previous
              </button>
              <button
                disabled={start + 120 >= glyphs.length}
                onClick={() => setStart(start + 120)}
              >
                Next
              </button>
            </div>
          )}
          <div className="add-characters">
            <label>
              Add Unicode characters
              <input
                aria-label="Custom characters"
                placeholder="é ñ Ω अ…"
                value={custom}
                onChange={(ev) => setCustom(ev.target.value)}
              />
            </label>
            <button onClick={addCustom}>Add characters</button>
            <button
              onClick={() => {
                const name = prompt("Name for an unencoded glyph");
                if (!name) return;
                const g = makeGlyph(name);
                edit("Add unencoded glyph", (p) => ({
                  ...p,
                  glyphs: { ...p.glyphs, [g.id]: g },
                }));
                select(g.id);
              }}
            >
              Add unencoded glyph
            </button>
          </div>
          <p className="local-note">
            Private by design.
            <br />
            Your lettering stays on your device.
          </p>
        </aside>
        <main className="editor-main">
          <div className="editor-heading">
            <div>
              <small>GLYPH EDITOR</small>
              <h1>
                {p.glyphs[selected]?.name === " "
                  ? "Space"
                  : (p.glyphs[selected]?.name ?? "Choose a glyph")}{" "}
                <span>Draw it. Shape it. Make it yours.</span>
              </h1>
            </div>
            <div className="button-row">
              <button
                aria-label="Undo"
                disabled={!past.length || e.busy}
                title={past.at(-1)?.name}
                onClick={() => {
                  useDocument.getState().undo();
                  e.set({ selection: [], nodes: [], draft: null });
                }}
              >
                <Undo2 size={17} />
              </button>
              <button
                aria-label="Redo"
                disabled={!future.length || e.busy}
                onClick={() => {
                  useDocument.getState().redo();
                  e.set({ selection: [], nodes: [], draft: null });
                }}
              >
                <Redo2 size={17} />
              </button>
              <button
                aria-label="Keyboard shortcuts"
                onClick={() => setDialog("help")}
              >
                <HelpCircle size={17} />
              </button>
            </div>
          </div>
          <div className="toolbar" role="toolbar" aria-label="Drawing tools">
            {tools.map((t) => (
              <button
                key={t.id}
                aria-pressed={e.tool === t.id}
                disabled={e.busy}
                className={e.tool === t.id ? "active" : ""}
                title={`${t.name} (${t.key})`}
                onClick={() => e.set({ tool: t.id })}
              >
                <t.icon size={18} />
                <span>{t.name}</span>
              </button>
            ))}
            <div className="toolbar-options">
              <label>
                <input
                  type="checkbox"
                  checked={e.outline}
                  onChange={(ev) => e.set({ outline: ev.target.checked })}
                />
                Outline
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={e.snap}
                  onChange={(ev) => e.set({ snap: ev.target.checked })}
                />
                Snap
              </label>
            </div>
          </div>
          <EditorCanvas />
          <Proof />
        </main>
        <div
          className={
            "property-wrapper " + (panel === "properties" ? "mobile-open" : "")
          }
        >
          <Properties />
        </div>
      </div>
      <Suspense fallback={<div className="loading-overlay">Opening…</div>}>
        {dialog === "projects" && <Projects close={() => setDialog(null)} />}{" "}
        {dialog === "import" && <Import close={() => setDialog(null)} />}{" "}
        {dialog === "worksheet" && <Worksheet close={() => setDialog(null)} />}
      </Suspense>
      {dialog === "help" && (
        <Modal title="Make every curve yours" onClose={() => setDialog(null)}>
          <p>
            Draw with Brush, construct with Bézier, or import a reference.
            Double-click an outline to edit its nodes.
          </p>
          <dl className="shortcuts">
            {[
              ["V / A", "Select outlines / edit nodes"],
              ["P / B / E", "Bézier pen / brush / eraser"],
              ["H / 0", "Pan / fit canvas"],
              ["Shift", "Extend selection; constrain transforms"],
              ["Alt", "Bypass snapping; break handle constraint"],
              [
                "Double-click curve",
                "Insert an anchor without changing its shape",
              ],
              ["Arrow / Shift + arrow", "Nudge by 1 / 10 units"],
              ["⌘ or Ctrl + Z", "Undo; add Shift to redo"],
              ["⌘ or Ctrl + D", "Duplicate selection"],
              ["Enter / Escape", "Finish pen path / cancel gesture"],
              ["Tab / Shift + Tab", "Select next / previous node"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p>
            Move curve handles or drag the curve itself. Use Properties for
            exact transforms, node types, split/join, and reusable components.
          </p>
        </Modal>
      )}
      {dialog === "export" && (
        <Modal title="Export your font" onClose={() => setDialog(null)}>
          <p>
            <strong>{p.name}</strong> · OpenType (.otf) · {count} glyphs with
            outlines
          </p>
          <p>
            Missing characters are omitted. Fallback behavior depends on the
            application using your font.
          </p>
          <div className="export-findings">
            {findings.map((f, i) => (
              <button
                key={i}
                onClick={() => {
                  if (f.glyphId) select(f.glyphId);
                  setDialog(null);
                }}
              >
                {f.severity === "error" ? "Fix: " : "Check: "}
                {f.message}
              </button>
            ))}
          </div>
          {exportError && <p role="alert">{exportError}</p>}
          {exported && (
            <p role="status">
              Download started. Open the OTF in your system’s font installer to
              install it.
            </p>
          )}
          <footer>
            <button onClick={() => setDialog(null)}>Close</button>
            <button
              className="primary"
              disabled={
                exportBusy ||
                !count ||
                findings.some((f) => f.severity === "error")
              }
              onClick={async () => {
                setExportBusy(true);
                setExportError("");
                try {
                  const snapshot = useDocument.getState().project,
                    buffer = await runJob<ArrayBuffer>(
                      "compile",
                      snapshot,
                      snapshot.revision,
                    );
                  download(
                    buffer,
                    (snapshot.name.replace(/[^\p{L}\p{N}\- ]/gu, "").trim() ||
                      "inkfont") + ".otf",
                    "font/otf",
                  );
                  setExported(true);
                } catch (err) {
                  setExportError((err as Error).message);
                } finally {
                  setExportBusy(false);
                }
              }}
            >
              {exportBusy ? "Building…" : "Download OTF"}
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
