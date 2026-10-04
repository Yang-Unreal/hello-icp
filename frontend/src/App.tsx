import { useState, useEffect } from "react";
import { createActor } from "./backend/api/backend";
import { getCanisterEnv } from "@icp-sdk/core/agent/canister-env";
import type { Note, NoteSummary, NoteVersion } from "./backend/api/backend";
import "./App.css";

interface CanisterEnv {
  readonly "PUBLIC_CANISTER_ID:backend": string;
}

const canisterEnv = getCanisterEnv<CanisterEnv>();
const canisterId = canisterEnv["PUBLIC_CANISTER_ID:backend"];

const actor = createActor(canisterId, {
  agentOptions: {
    rootKey: canisterEnv.IC_ROOT_KEY,
  },
});

function formatTime(t: bigint): string {
  const ms = Number(t / 1_000_000n);
  return new Date(ms).toLocaleString();
}

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

type View = "list" | "view" | "edit" | "history" | "prove" | "create";

function App() {
  const [view, setView] = useState<View>("list");
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [viewingVersion, setViewingVersion] = useState<NoteVersion | null>(null);
  const [history, setHistory] = useState<NoteVersion[]>([]);
  const [proveVersion, setProveVersion] = useState<NoteVersion | null>(null);
  const [proveHash, setProveHash] = useState<string>("");

  const [form, setForm] = useState({ title: "", content: "", tags: "", author: "" });

  const loadNotes = async () => {
    const all = await actor.getAllNotes();
    setNotes(all);
  };

  const loadNote = async (noteId: string) => {
    const note = await actor.getNote(noteId);
    setCurrentNote(note);
    setViewingVersion(null);
    setView("view");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const tags = form.tags.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    await actor.createNote(form.title, form.content, tags, form.author);
    setForm({ title: "", content: "", tags: "", author: "" });
    await loadNotes();
    setView("list");
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNoteId) return;
    const tags = form.tags.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    await actor.updateNote(selectedNoteId, form.title, form.content, tags, form.author);
    setForm({ title: "", content: "", tags: "", author: "" });
    await loadNote(selectedNoteId);
    await loadNotes();
    setView("view");
  };

  const handleDelete = async () => {
    if (!selectedNoteId) return;
    await actor.deleteNote(selectedNoteId);
    setSelectedNoteId(null);
    setCurrentNote(null);
    await loadNotes();
    setView("list");
  };

  const startEdit = () => {
    if (!currentNote) return;
    const last = currentNote.versions[currentNote.versions.length - 1];
    setForm({
      title: last.title,
      content: last.content,
      tags: last.tags.join(", "),
      author: last.author,
    });
    setView("edit");
  };

  const loadHistory = async () => {
    if (!selectedNoteId) return;
    const h = await actor.getVersionHistory(selectedNoteId);
    setHistory(h || []);
    setView("history");
  };

  const viewVersion = (v: NoteVersion) => {
    setViewingVersion(v);
    setView("view");
  };

  const showProve = async (v: NoteVersion) => {
    setProveVersion(v);
    const hash = await sha256(v.content);
    setProveHash(hash);
    setView("prove");
  };

  useEffect(() => {
    loadNotes();
  }, []);

  return (
    <main className="kb-page">
      <header className="kb-header">
        <h1>On-Chain Knowledge Base</h1>
        <p>Versioned notes with immutable timestamp proof</p>
      </header>

      <div className="kb-layout">
        <aside className="kb-sidebar">
          <button className="kb-btn-primary" onClick={() => { setForm({ title: "", content: "", tags: "", author: "" }); setView("create"); }}>
            + New Note
          </button>
          <div className="kb-note-list">
            {notes.length === 0 && <p className="kb-empty">No notes yet.</p>}
            {notes.map((n) => (
              <div
                key={n.id}
                className={`kb-note-card ${selectedNoteId === n.id ? "active" : ""}`}
                onClick={() => { setSelectedNoteId(n.id); loadNote(n.id); }}
              >
                <div className="kb-note-card-title">{n.title || "Untitled"}</div>
                <div className="kb-note-card-meta">
                  v{currentNote && selectedNoteId === n.id ? currentNote.versions.length : "?"} · {formatTime(n.updatedAt)}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="kb-main">
          {view === "create" && (
            <form className="kb-form" onSubmit={handleCreate}>
              <h2>New Note</h2>
              <label>
                Title
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </label>
              <label>
                Content
                <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={8} required />
              </label>
              <label>
                Tags (comma separated)
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
              </label>
              <label>
                Author
                <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} required />
              </label>
              <div className="kb-form-actions">
                <button type="submit" className="kb-btn-primary">Create Note</button>
                <button type="button" className="kb-btn" onClick={() => setView("list")}>Cancel</button>
              </div>
            </form>
          )}

          {view === "list" && (
            <div className="kb-welcome">
              <h2>Welcome</h2>
              <p>Select a note from the sidebar or create a new one to get started.</p>
            </div>
          )}

          {view === "view" && currentNote && (
            <div className="kb-detail">
              <div className="kb-detail-header">
                <h2>{viewingVersion ? `v${viewingVersion.version.toString()}` : "Current Version"}</h2>
                <div className="kb-actions">
                  {!viewingVersion && (
                    <>
                      <button className="kb-btn" onClick={startEdit}>Edit</button>
                      <button className="kb-btn" onClick={loadHistory}>History</button>
                      <button className="kb-btn-danger" onClick={handleDelete}>Delete</button>
                    </>
                  )}
                  <button className="kb-btn" onClick={() => { setViewingVersion(null); setView("view"); }}>Back to Current</button>
                </div>
              </div>
              <div className="kb-meta">
                <span><strong>Title:</strong> {viewingVersion ? viewingVersion.title : currentNote.versions[currentNote.versions.length - 1].title}</span>
                <span><strong>Author:</strong> {viewingVersion ? viewingVersion.author : currentNote.versions[currentNote.versions.length - 1].author}</span>
                <span><strong>Version:</strong> {viewingVersion ? viewingVersion.version.toString() : currentNote.versions.length.toString()}</span>
                <span><strong>Timestamp:</strong> {formatTime(viewingVersion ? viewingVersion.timestamp : currentNote.versions[currentNote.versions.length - 1].timestamp)}</span>
              </div>
              <div className="kb-tags">
                {(viewingVersion ? viewingVersion.tags : currentNote.versions[currentNote.versions.length - 1].tags).map((t, i) => (
                  <span key={i} className="kb-tag">{t}</span>
                ))}
              </div>
              <div className="kb-content">
                {viewingVersion ? viewingVersion.content : currentNote.versions[currentNote.versions.length - 1].content}
              </div>
              <div className="kb-prove-row">
                <button className="kb-btn-accent"                   onClick={() => showProve(viewingVersion || currentNote.versions[currentNote.versions.length - 1])}>
                  Prove Existence
                </button>
              </div>
            </div>
          )}

          {view === "edit" && currentNote && (
            <form className="kb-form" onSubmit={handleUpdate}>
              <h2>Edit Note</h2>
              <label>
                Title
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </label>
              <label>
                Content
                <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={8} required />
              </label>
              <label>
                Tags (comma separated)
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
              </label>
              <label>
                Author
                <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} required />
              </label>
              <div className="kb-form-actions">
                <button type="submit" className="kb-btn-primary">Save Version</button>
                <button type="button" className="kb-btn" onClick={() => setView("view")}>Cancel</button>
              </div>
            </form>
          )}

          {view === "history" && (
            <div className="kb-history">
              <h2>Version History</h2>
              <div className="kb-history-list">
                {history.map((v) => (
                  <div key={v.version.toString()} className="kb-history-item">
                    <div className="kb-history-version">v{v.version.toString()}</div>
                    <div className="kb-history-title">{v.title}</div>
                    <div className="kb-history-meta">{formatTime(v.timestamp)} · by {v.author}</div>
                    <div className="kb-history-actions">
                      <button className="kb-btn" onClick={() => viewVersion(v)}>View</button>
                      <button className="kb-btn-accent" onClick={() => showProve(v)}>Prove</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === "prove" && proveVersion && (
            <div className="kb-prove">
              <h2>Existence Proof</h2>
              <div className="kb-meta">
                <span><strong>Note ID:</strong> {selectedNoteId}</span>
                <span><strong>Version:</strong> {proveVersion.version.toString()}</span>
                <span><strong>Timestamp:</strong> {formatTime(proveVersion.timestamp)}</span>
                <span><strong>Author:</strong> {proveVersion.author}</span>
              </div>
              <div className="kb-proof-block">
                <strong>Content SHA-256:</strong>
                <code>{proveHash}</code>
              </div>
              <div className="kb-proof-block">
                <strong>Content:</strong>
                <pre>{proveVersion.content}</pre>
              </div>
              <p className="kb-proof-note">
                This timestamp and hash are recorded on the Internet Computer blockchain.
                Anyone can query the canister to verify this content existed at the stated time.
              </p>
              <button className="kb-btn" onClick={() => setView("view")}>Back</button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default App;
