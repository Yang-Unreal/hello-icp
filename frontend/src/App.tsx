import { useState, useEffect } from "react";
import { createActor } from "./backend/api/backend";
import { getCanisterEnv } from "@icp-sdk/core/agent/canister-env";
import ReactMarkdown from "react-markdown";
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

type View = "list" | "read" | "create" | "edit" | "history";

interface TreeNode extends NoteSummary {
  children?: TreeNode[];
}

function App() {
  const [view, setView] = useState<View>("list");
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [viewingVersion, setViewingVersion] = useState<NoteVersion | null>(null);
  const [history, setHistory] = useState<NoteVersion[]>([]);
  const [subtree, setSubtree] = useState<Note[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [treeCache, setTreeCache] = useState<Map<string, TreeNode[]>>(new Map());

  const [form, setForm] = useState({ title: "", content: "", tags: "", author: "", parentId: "" });

  const loadNotes = async () => {
    const all = await actor.getAllNotes();
    setNotes(all);
  };

  const findRoot = async (noteId: string): Promise<string> => {
    const note = await actor.getNote(noteId);
    if (!note) return noteId;
    if (!note.parentId) return noteId;
    return findRoot(note.parentId);
  };

  const expandAncestors = async (noteId: string) => {
    let current = noteId;
    const ancestors: string[] = [];
    while (true) {
      const note = await actor.getNote(current);
      if (!note || !note.parentId) break;
      ancestors.push(note.parentId);
      current = note.parentId;
    }
    setExpandedNodes(prev => {
      const next = new Set(prev);
      for (const id of ancestors) next.add(id);
      return next;
    });
    for (const id of ancestors) {
      await loadChildren(id);
    }
  };

  const loadNote = async (noteId: string) => {
    const note = await actor.getNote(noteId);
    setCurrentNote(note);
    setViewingVersion(null);
    setView("read");

    const rootId = await findRoot(noteId);
    const fullSubtree = await loadSubtree(rootId);
    setSubtree(fullSubtree);

    await expandAncestors(noteId);

    setTimeout(() => {
      const el = document.getElementById(`note-${noteId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);

    setSelectedNoteId(noteId);
  };

  const loadChildren = async (parentId: string) => {
    if (treeCache.has(parentId)) {
      return treeCache.get(parentId)!;
    }
    const children = await actor.getChildren(parentId);
    const nodes: TreeNode[] = children.map(c => ({ ...c, children: [] }));
    setTreeCache(prev => {
      const next = new Map(prev);
      next.set(parentId, nodes);
      return next;
    });
    return nodes;
  };

  const loadSubtree = async (parentId: string): Promise<Note[]> => {
    const note = await actor.getNote(parentId);
    if (!note) return [];
    const children = await actor.getChildren(parentId);
    let childNotes: Note[] = [];
    for (const child of children) {
      const descendants = await loadSubtree(child.id);
      childNotes = childNotes.concat(descendants);
    }
    return [note, ...childNotes];
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const tags = form.tags.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    const parentId = form.parentId ? form.parentId : null;
    await actor.createNote(form.title, form.content, tags, form.author, parentId);
    setForm({ title: "", content: "", tags: "", author: "", parentId: "" });
    setTreeCache(new Map());
    setExpandedNodes(new Set());
    await loadNotes();
    setView("list");
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNoteId) return;
    const tags = form.tags.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    await actor.updateNote(selectedNoteId, form.title, form.content, tags, form.author);
    setForm({ title: "", content: "", tags: "", author: "", parentId: "" });
    await loadNote(selectedNoteId);
    await loadNotes();
    setView("read");
  };

  const handleDelete = async () => {
    if (!selectedNoteId) return;
    await actor.deleteNote(selectedNoteId);
    setSelectedNoteId(null);
    setCurrentNote(null);
    setTreeCache(new Map());
    setExpandedNodes(new Set());
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
      parentId: currentNote.parentId ? currentNote.parentId : "",
    });
    setView("edit");
  };

  const startCreateChild = () => {
    if (!currentNote) return;
    setForm({ title: "", content: "", tags: "", author: "", parentId: currentNote.id });
    setView("create");
  };

  const loadHistory = async () => {
    if (!selectedNoteId) return;
    const h = await actor.getVersionHistory(selectedNoteId);
    setHistory(h || []);
    setView("history");
  };

  const viewVersion = (v: NoteVersion) => {
    setViewingVersion(v);
    setView("read");
  };

  const toggleNode = async (node: TreeNode) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(node.id)) {
      newExpanded.delete(node.id);
      setExpandedNodes(newExpanded);
    } else {
      newExpanded.add(node.id);
      setExpandedNodes(newExpanded);
      await loadChildren(node.id);
    }
  };

  const filteredNotes = notes.filter((n) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return n.title.toLowerCase().includes(q) || n.id.includes(q);
  });

  const rootNotes = filteredNotes.filter(n => !n.parentId);

  useEffect(() => {
    loadNotes();
  }, []);

  const currentVersion = viewingVersion || (currentNote ? currentNote.versions[currentNote.versions.length - 1] : null);

  const renderTreeNode = (node: TreeNode, depth: number = 0) => {
    const children = treeCache.get(node.id) || [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedNodes.has(node.id);
    const isActive = selectedNoteId === node.id;

    return (
      <div key={node.id} className="kb-tree-item">
        <div
          className={`kb-tree-node ${isActive ? "active" : ""}`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => {
            toggleNode(node);
            setSelectedNoteId(node.id);
            loadNote(node.id);
          }}
        >
          <span
            className={`kb-tree-toggle ${isExpanded ? "expanded" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleNode(node);
            }}
          >
            ▶
          </span>
          <span className="kb-tree-title">{node.title || "Untitled"}</span>
        </div>
        {isExpanded && hasChildren && (
          <div className="kb-tree-children">
            {children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const buildTree = (nodes: Note[]): TreeNode[] => {
    const map = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    for (const note of nodes) {
      const last = note.versions[note.versions.length - 1];
      map.set(note.id, {
        id: note.id,
        title: last.title,
        updatedAt: last.timestamp,
        parentId: note.parentId,
        children: []
      });
    }

    for (const note of nodes) {
      if (note.parentId) {
        const parent = map.get(note.parentId);
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(map.get(note.id)!);
        }
      } else {
        roots.push(map.get(note.id)!);
      }
    }

    return roots;
  };

  const renderSubtree = (nodes: Note[], depth: number = 0) => {
    const tree = buildTree(nodes);
    const renderLevel = (items: TreeNode[], d: number) => {
      return items.map((item) => {
        const children = item.children || [];
        const hasChildren = children.length > 0;
        const note = nodes.find(n => n.id === item.id);
        const last = note ? note.versions[note.versions.length - 1] : null;
        return (
          <div key={item.id} id={`note-${item.id}`} className="kb-subtree-section" style={{ paddingLeft: `${d * 16}px` }}>
            {hasChildren && <div className="kb-subtree-indent" />}
            <h2>{item.title}</h2>
            {last && (
              <>
                <div className="kb-meta">
                  <span><strong>Author:</strong> {last.author}</span>
                  <span><strong>Version:</strong> {last.version.toString()}</span>
                  <span><strong>Updated:</strong> {formatTime(last.timestamp)}</span>
                </div>
                <div className="kb-tags">
                  {last.tags.map((t, i) => (
                    <span key={i} className="kb-tag">{t}</span>
                  ))}
                </div>
              </>
            )}
            <ReactMarkdown>{last ? last.content : ""}</ReactMarkdown>
            {hasChildren && renderLevel(children, d + 1)}
          </div>
        );
      });
    };
    return renderLevel(tree, depth);
  };

  return (
    <main className="kb-page">
      <header className="kb-header">
        <div className="kb-header-left">
          <h1>On-Chain Knowledge Base</h1>
          <p>Markdown docs with nested sections</p>
        </div>
        <div className="kb-header-actions">
          {selectedNoteId && !viewingVersion && (
            <>
              <button className="kb-btn" onClick={startEdit}>Edit</button>
              <button className="kb-btn" onClick={startCreateChild}>Add child</button>
              <button className="kb-btn" onClick={loadHistory}>History</button>
              <button className="kb-btn-danger" onClick={handleDelete}>Delete</button>
            </>
          )}
          {viewingVersion && (
            <button className="kb-btn" onClick={() => { setViewingVersion(null); setView("read"); }}>Back to Current</button>
          )}
        </div>
      </header>

      <div className="kb-layout">
        <aside className="kb-sidebar">
          <div className="kb-sidebar-top">
            <input
              className="kb-search"
              type="text"
              placeholder="Search docs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button className="kb-btn-primary" onClick={() => { setForm({ title: "", content: "", tags: "", author: "", parentId: "" }); setView("create"); }}>
              + New Page
            </button>
          </div>
          <div className="kb-tree">
            {rootNotes.length === 0 && <p className="kb-empty">No pages yet.</p>}
            {rootNotes.map((n) => renderTreeNode(n))}
          </div>
        </aside>

        <section className="kb-main">
          {view === "list" && (
            <div className="kb-welcome">
              <h2>Welcome</h2>
              <p>Select a page from the sidebar or create a new one.</p>
            </div>
          )}

          {view === "read" && currentNote && currentVersion && (
            <div className="kb-detail kb-read">
              {viewingVersion && (
                <div className="kb-detail-header">
                  <h2>History: {currentVersion.title}</h2>
                </div>
              )}
              <div className="kb-content kb-markdown">
                {viewingVersion ? (
                  <ReactMarkdown>{viewingVersion.content}</ReactMarkdown>
                ) : (
                  renderSubtree(subtree, 0)
                )}
              </div>
            </div>
          )}

          {view === "create" && (
            <form className="kb-form" onSubmit={handleCreate}>
              <h2>New Page</h2>
              <label>
                Title
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </label>
              <label>
                Content
                <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={14} required />
              </label>
              <label>
                Tags (comma separated)
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
              </label>
              <label>
                Author
                <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} required />
              </label>
              {form.parentId && (
                <div className="kb-meta">
                  <span><strong>Parent:</strong> {form.parentId}</span>
                </div>
              )}
              <div className="kb-form-actions">
                <button type="submit" className="kb-btn-primary">Create</button>
                <button type="button" className="kb-btn" onClick={() => setView("list")}>Cancel</button>
              </div>
            </form>
          )}

          {view === "edit" && currentNote && (
            <form className="kb-form" onSubmit={handleUpdate}>
              <h2>Edit Page</h2>
              <label>
                Title
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </label>
              <label>
                Content
                <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={14} required />
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
                <button type="submit" className="kb-btn-primary">Save</button>
                <button type="button" className="kb-btn" onClick={() => setView("read")}>Cancel</button>
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
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default App;
