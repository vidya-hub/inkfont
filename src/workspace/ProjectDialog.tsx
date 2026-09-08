import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { useDocument, flushSave } from "../core/store";
import {
  repository,
  projectArchive,
  readArchive,
  download,
  type ProjectSummary,
} from "../core/repository";
import { newProject, uid } from "../core/model";
export function ProjectDialog({ close }: { close: () => void }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [name, setName] = useState("My handwriting");
  const refresh = () =>
    repository
      .list()
      .then(setProjects)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void refresh();
  }, []);
  const task = async (fn: () => Promise<void>) => {
    setWorking(true);
    setError("");
    try {
      await flushSave();
      if (useDocument.getState().status === "error")
        throw new Error(
          "Save failed. Download a backup before changing projects.",
        );
      await fn();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  };
  return (
    <Modal title="Your local projects" onClose={close}>
      <p>
        Projects stay in this browser. Download a backup to move your work or
        protect it from browser data removal.
      </p>
      <div className="button-row">
        <input
          aria-label="New project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          disabled={working}
          className="primary"
          onClick={() =>
            void task(async () => {
              useDocument.getState().install(newProject(name || "Untitled"));
              close();
            })
          }
        >
          New project
        </button>
      </div>
      <div className="button-row">
        <button
          onClick={() => {
            const p = useDocument.getState().project;
            download(projectArchive(p) as BlobPart, p.name + ".inkfont");
          }}
        >
          Download editable backup
        </button>
        <label className="file-button">
          Open backup
          <input
            type="file"
            accept=".inkfont"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                void task(async () => {
                  const p = readArchive(new Uint8Array(await f.arrayBuffer()));
                  useDocument.getState().install(p);
                  close();
                });
            }}
          />
        </label>
      </div>
      <div className="project-list">
        {projects.map((p) => (
          <div key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <small>
                {p.deleted ? "In trash" : new Date(p.updated).toLocaleString()}
              </small>
            </div>
            <div className="button-row">
              {p.deleted ? (
                <>
                  <button
                    disabled={working}
                    onClick={() => void task(() => repository.restore(p.id))}
                  >
                    Restore
                  </button>
                  <button
                    disabled={working}
                    onClick={() => {
                      if (confirm("Permanently delete this local project?"))
                        void task(() => repository.destroy(p.id));
                    }}
                  >
                    Delete forever
                  </button>
                </>
              ) : (
                <>
                  <button
                    disabled={working}
                    onClick={() =>
                      void task(async () => {
                        useDocument
                          .getState()
                          .install(await repository.load(p.id), true);
                        close();
                      })
                    }
                  >
                    Open
                  </button>
                  <button
                    disabled={working}
                    onClick={() =>
                      void task(async () => {
                        const copy = await repository.load(p.id);
                        await repository.save(
                          {
                            ...copy,
                            id: uid(),
                            name: copy.name + " copy",
                            revision: 0,
                            updated: Date.now(),
                          },
                          null,
                        );
                      })
                    }
                  >
                    Duplicate
                  </button>
                  <button
                    disabled={
                      working || p.id === useDocument.getState().project.id
                    }
                    onClick={() => void task(() => repository.remove(p.id))}
                  >
                    Trash
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
