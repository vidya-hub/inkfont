import { create } from "zustand";
import { newProject, uid, validateProject, type FontProject } from "./model";
import { repository } from "./repository";
import { migrateLegacy } from "./conversion";
interface Entry {
  name: string;
  before: FontProject;
  after: FontProject;
  bytes: number;
}
interface State {
  project: FontProject;
  ready: boolean;
  status: "loading" | "saving" | "saved" | "error";
  error: string;
  past: Entry[];
  future: Entry[];
  selected: string;
  modal: boolean;
  edit: (name: string, update: (p: FontProject) => FontProject) => void;
  undo: () => void;
  redo: () => void;
  select: (id: string) => void;
  install: (p: FontProject, saved?: boolean) => void;
}
export const useDocument = create<State>((set, get) => ({
  project: newProject(),
  ready: false,
  status: "loading",
  error: "",
  past: [],
  future: [],
  selected: "",
  modal: false,
  edit: (name, update) => {
    const s = get(),
      after = update(s.project);
    if (after === s.project) return;
    const old = s.project;
    const same = (a: unknown, b: unknown) =>
      a === b || JSON.stringify(a) === JSON.stringify(b);
    if (
      after.name === old.name &&
      after.style === old.style &&
      same(after.metrics, old.metrics) &&
      same(after.mappings, old.mappings) &&
      same(after.kerning, old.kerning) &&
      Object.keys(after.glyphs).length === Object.keys(old.glyphs).length &&
      Object.entries(after.glyphs).every(([id, g]) => same(g, old.glyphs[id]))
    )
      return;
    validateProject(after);
    const next = {
      ...after,
      revision: s.project.revision + 1,
      updated: Date.now(),
    };
    const bytes = Object.entries(next.glyphs).reduce(
      (sum, [id, g]) =>
        sum + (g !== s.project.glyphs[id] ? JSON.stringify(g).length * 2 : 0),
      1024,
    );
    const past = [
      ...s.past,
      { name, before: s.project, after: next, bytes },
    ].slice(-100);
    let total = past.reduce((n, e) => n + e.bytes, 0);
    while (past.length > 1 && total > 64 * 1024 * 1024)
      total -= past.shift()!.bytes;
    set({
      project: next,
      past,
      future: [],
    });
    scheduleSave();
  },
  undo: () => {
    const s = get(),
      e = s.past.at(-1);
    if (!e) return;
    set({
      project: {
        ...e.before,
        revision: s.project.revision + 1,
        updated: Date.now(),
      },
      past: s.past.slice(0, -1),
      future: [...s.future, e],
    });
    scheduleSave();
  },
  redo: () => {
    const s = get(),
      e = s.future.at(-1);
    if (!e) return;
    set({
      project: {
        ...e.after,
        revision: s.project.revision + 1,
        updated: Date.now(),
      },
      future: s.future.slice(0, -1),
      past: [...s.past, e],
    });
    scheduleSave();
  },
  select: (selected) => set({ selected }),
  install: (project, saved = false) => {
    epoch++;
    persisted = saved ? project : undefined;
    set({
      project,
      ready: true,
      status: saved ? "saved" : "saving",
      past: [],
      future: [],
      error: "",
      selected: project.mappings.A ?? Object.keys(project.glyphs)[0],
    });
    try {
      localStorage.setItem("inkfont.active", project.id);
    } catch {
      /* optional preference */
    }
    if (!saved) scheduleSave();
  },
}));
let persisted: FontProject | undefined,
  timer: ReturnType<typeof setTimeout>,
  epoch = 0,
  chain = Promise.resolve();
function scheduleSave() {
  clearTimeout(timer);
  useDocument.setState({ status: "saving" });
  timer = setTimeout(() => {
    void flushSave();
  }, 300);
}
export function flushSave() {
  clearTimeout(timer);
  const task = async () => {
    const s = useDocument.getState();
    if (!s.ready || s.project === persisted) return;
    const p = s.project,
      e = epoch;
    try {
      await repository.save(p, persisted?.revision ?? null, persisted);
      if (e !== epoch) return;
      persisted = p;
      if (useDocument.getState().project === p)
        useDocument.setState({ status: "saved", error: "" });
    } catch (err) {
      if (e !== epoch) return;
      if ((err as Error).message === "CONFLICT") {
        const copy = {
          ...useDocument.getState().project,
          id: uid(),
          name: p.name + " (conflict copy)",
          revision: 0,
        };
        useDocument.getState().install(copy);
        useDocument.setState({
          error:
            "Another tab saved this project. Your edits were preserved as a conflict copy.",
        });
      } else
        useDocument.setState({
          status: "error",
          error:
            "Local save failed. Download a project backup to preserve your edits.",
        });
    }
  };
  chain = chain.then(task, task);
  return chain;
}
let initialization: Promise<void> | undefined;
export function initialize() {
  return (initialization ??= (async () => {
    try {
      const list = await repository.list(),
        active = localStorage.getItem("inkfont.active"),
        existing =
          list.find((p) => p.id === active && !p.deleted) ??
          list.find((p) => !p.deleted);
      if (existing) {
        useDocument
          .getState()
          .install(await repository.load(existing.id), true);
        return;
      }
      const legacy = localStorage.getItem("inkfont-project"),
        p = legacy ? migrateLegacy(legacy) : newProject();
      await repository.save(p, null);
      const checked = await repository.load(p.id);
      useDocument.getState().install(checked, true);
    } catch (err) {
      useDocument.setState({
        ready: true,
        status: "error",
        error: (err as Error).message,
        selected: useDocument.getState().project.mappings.A,
      });
    }
  })());
}
