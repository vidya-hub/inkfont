import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { validateProject, uid, type FontProject } from "./model";
export interface ProjectSummary {
  id: string;
  name: string;
  updated: number;
  revision: number;
  deleted?: number;
}
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const complete = (t: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onabort = () => reject(t.error ?? new Error("Save aborted"));
    t.onerror = () => reject(t.error);
  });
export class ProjectRepository {
  private db?: Promise<IDBDatabase>;
  private open() {
    return (this.db ??= new Promise((resolve, reject) => {
      const r = indexedDB.open("inkfont-studio", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("projects", { keyPath: "id" });
        r.result.createObjectStore("glyphs", { keyPath: "key" });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () =>
        reject(new Error("Close other Inkfont tabs to upgrade storage."));
    }));
  }
  async list(): Promise<ProjectSummary[]> {
    const db = await this.open();
    const rows = await request(
      db.transaction("projects").objectStore("projects").getAll(),
    );
    return rows
      .map(({ id, name, updated, revision, deleted }) => ({
        id,
        name,
        updated,
        revision,
        deleted,
      }))
      .sort((a, b) => b.updated - a.updated);
  }
  async load(id: string): Promise<FontProject> {
    const db = await this.open(),
      tx = db.transaction(["projects", "glyphs"]),
      meta = await request(tx.objectStore("projects").get(id));
    if (!meta) throw new Error("Project not found.");
    const rows = await request(
      tx
        .objectStore("glyphs")
        .getAll(IDBKeyRange.bound(id + ":", id + ":\uffff")),
    );
    return validateProject({
      ...meta,
      glyphs: Object.fromEntries(rows.map((r) => [r.glyph.id, r.glyph])),
    });
  }
  async save(
    p: FontProject,
    expected: number | null,
    previous?: FontProject,
  ): Promise<void> {
    const db = await this.open(),
      tx = db.transaction(["projects", "glyphs"], "readwrite"),
      done = complete(tx);
    done.catch(() => {});
    const meta = tx.objectStore("projects"),
      stored = await request(meta.get(p.id));
    if (stored && stored.revision !== expected) {
      tx.abort();
      throw new Error("CONFLICT");
    }
    const { glyphs, ...rest } = p;
    meta.put(rest);
    const gs = tx.objectStore("glyphs");
    for (const [id, g] of Object.entries(glyphs))
      if (!previous || previous.glyphs[id] !== g)
        gs.put({ key: p.id + ":" + id, glyph: g });
    if (previous)
      for (const id of Object.keys(previous.glyphs))
        if (!glyphs[id]) gs.delete(p.id + ":" + id);
    await done;
  }
  async remove(id: string) {
    const p = await this.load(id);
    await this.save(
      { ...p, deleted: Date.now(), revision: p.revision + 1 },
      p.revision,
    );
  }
  async restore(id: string) {
    const p = await this.load(id);
    delete p.deleted;
    await this.save({ ...p, revision: p.revision + 1 }, p.revision);
  }
  async destroy(id: string) {
    const db = await this.open(),
      tx = db.transaction(["projects", "glyphs"], "readwrite"),
      done = complete(tx);
    tx.objectStore("projects").delete(id);
    tx.objectStore("glyphs").delete(
      IDBKeyRange.bound(id + ":", id + ":\uffff"),
    );
    await done;
  }
}
export const repository = new ProjectRepository();
export function projectArchive(p: FontProject): Uint8Array {
  return zipSync(
    {
      "manifest.json": strToU8(
        JSON.stringify({ format: "inkfont", version: 1 }),
      ),
      "project.json": strToU8(JSON.stringify(p)),
    },
    { level: 6 },
  );
}
export function readArchive(bytes: Uint8Array): FontProject {
  if (bytes.length > 32 * 1024 * 1024) throw new Error("Backup exceeds 32 MB.");
  let total = 0,
    count = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      total += f.originalSize;
      if (++count > 16 || total > 64 * 1024 * 1024)
        throw new Error("Expanded backup is too large.");
      if (f.name !== "manifest.json" && f.name !== "project.json")
        throw new Error("Unexpected backup entry.");
      return true;
    },
  });
  const m = JSON.parse(strFromU8(files["manifest.json"] ?? new Uint8Array()));
  if (m.format !== "inkfont" || m.version !== 1)
    throw new Error("Unsupported backup format.");
  const p = validateProject(JSON.parse(strFromU8(files["project.json"])));
  return {
    ...p,
    id: uid(),
    revision: 0,
    updated: Date.now(),
    deleted: undefined,
  };
}
export function download(
  data: BlobPart,
  name: string,
  type = "application/octet-stream",
) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
