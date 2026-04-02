import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Note {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string | null;
  parentNoteId: string | null;
  replies: Note[];
}

interface Task {
  id: string;
  title: string;
  dueAt: string | null;
  status: 'open' | 'done';
  assignedToUserId: string | null;
  assigneeName: string | null;
  createdAt: string;
}

type ObjectType = 'contact' | 'deal';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (s: string | null) => {
  if (!s) return '';
  return new Intl.DateTimeFormat('ca-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(s));
};

const fmtDateTime = (s: string | null) => {
  if (!s) return '';
  return new Intl.DateTimeFormat('ca-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(s));
};

// ─── NoteCard ─────────────────────────────────────────────────────────────────

function NoteCard({
  note,
  isReply,
  objectType,
  objectId,
  onDelete,
  onUpdate,
  onReplyAdded,
}: {
  note: Note;
  isReply?: boolean;
  objectType: ObjectType;
  objectId: string;
  onDelete: (id: string) => void;
  onUpdate: (id: string, body: string, updatedAt: string) => void;
  onReplyAdded: (parentId: string, reply: Note) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(note.body);
  const [saving, setSaving] = useState(false);

  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [savingReply, setSavingReply] = useState(false);

  async function saveEdit() {
    if (!editBody.trim() || saving) return;
    setSaving(true);
    try {
      const res = await api.patch(`/api/notes/${note.id}`, { body: editBody.trim() });
      onUpdate(note.id, res.body, res.updatedAt);
      setEditing(false);
    } catch {
      alert('Error en guardar els canvis.');
    } finally {
      setSaving(false);
    }
  }

  async function addReply() {
    if (!replyBody.trim() || savingReply) return;
    setSavingReply(true);
    try {
      const reply = await api.post('/api/notes', {
        objectType,
        objectId,
        body: replyBody.trim(),
        parentNoteId: note.id,
      });
      onReplyAdded(note.id, { ...reply, replies: [] });
      setReplyBody('');
      setReplyOpen(false);
    } catch {
      alert('Error en guardar la resposta.');
    } finally {
      setSavingReply(false);
    }
  }

  return (
    <div style={isReply ? replyNoteStyle : noteStyle}>
      {/* Body / Edit mode */}
      {editing ? (
        <div>
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={3}
            style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button
              onClick={saveEdit}
              disabled={!editBody.trim() || saving}
              style={primaryBtn}
            >
              {saving ? 'Guardant...' : 'Desar'}
            </button>
            <button
              onClick={() => { setEditing(false); setEditBody(note.body); }}
              style={ghostBtn}
            >
              Cancel·lar
            </button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{note.body}</div>
      )}

      {/* Meta row */}
      {!editing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#aaa' }}>
            {note.authorName ?? 'Usuari'} · {fmtDateTime(note.createdAt)}
            {note.updatedAt && <span style={{ marginLeft: 4, fontStyle: 'italic' }}>· editat</span>}
          </span>
          <button
            onClick={() => setEditing(true)}
            style={ghostEditBtn}
            title="Editar nota"
          >
            ✎
          </button>
          {!isReply && (
            <button
              onClick={() => setReplyOpen(!replyOpen)}
              style={ghostBtn}
              title="Respondre"
            >
              Respondre{note.replies.length > 0 ? ` (${note.replies.length})` : ''}
            </button>
          )}
          <button
            onClick={() => onDelete(note.id)}
            style={ghostDangerBtn}
            title="Eliminar nota"
          >
            ×
          </button>
        </div>
      )}

      {/* Reply input */}
      {!isReply && replyOpen && (
        <div style={{ marginTop: 10 }}>
          <textarea
            placeholder="Escriu una resposta..."
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={2}
            style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addReply();
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              onClick={addReply}
              disabled={!replyBody.trim() || savingReply}
              style={primaryBtn}
            >
              {savingReply ? 'Guardant...' : 'Respondre'}
            </button>
            <button onClick={() => { setReplyOpen(false); setReplyBody(''); }} style={ghostBtn}>
              Cancel·lar
            </button>
          </div>
        </div>
      )}

      {/* Nested replies */}
      {!isReply && note.replies.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {note.replies.map((r) => (
            <NoteCard
              key={r.id}
              note={r}
              isReply
              objectType={objectType}
              objectId={objectId}
              onDelete={onDelete}
              onUpdate={onUpdate}
              onReplyAdded={onReplyAdded}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NotesTasks({
  objectType,
  objectId,
}: {
  objectType: ObjectType;
  objectId: string;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(true);

  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [savingTask, setSavingTask] = useState(false);

  useEffect(() => {
    const qs = `?objectType=${objectType}&objectId=${objectId}`;
    api
      .get(`/api/notes${qs}`)
      .then((rows: Note[]) => setNotes(rows))
      .finally(() => setLoadingNotes(false));
    api
      .get(`/api/tasks${qs}`)
      .then((rows: Task[]) => setTasks(rows))
      .finally(() => setLoadingTasks(false));
  }, [objectType, objectId]);

  async function addNote() {
    if (!noteBody.trim() || savingNote) return;
    setSavingNote(true);
    try {
      const note = await api.post('/api/notes', {
        objectType,
        objectId,
        body: noteBody.trim(),
      });
      setNotes([{ ...note, replies: [] }, ...notes]);
      setNoteBody('');
    } catch {
      alert('Error en guardar la nota.');
    } finally {
      setSavingNote(false);
    }
  }

  function handleDeleteNote(id: string) {
    if (!confirm('Eliminar aquesta nota?')) return;
    api.delete(`/api/notes/${id}`);
    setNotes(
      notes
        .filter((n) => n.id !== id)
        .map((n) => ({ ...n, replies: n.replies.filter((r) => r.id !== id) })),
    );
  }

  function handleUpdateNote(id: string, body: string, updatedAt: string) {
    setNotes(
      notes.map((n) => {
        if (n.id === id) return { ...n, body, updatedAt };
        return { ...n, replies: n.replies.map((r) => (r.id === id ? { ...r, body, updatedAt } : r)) };
      }),
    );
  }

  function handleReplyAdded(parentId: string, reply: Note) {
    setNotes(
      notes.map((n) =>
        n.id === parentId ? { ...n, replies: [...n.replies, reply] } : n,
      ),
    );
  }

  async function addTask() {
    if (!taskTitle.trim() || savingTask) return;
    setSavingTask(true);
    try {
      const task = await api.post('/api/tasks', {
        objectType,
        objectId,
        title: taskTitle.trim(),
        dueAt: taskDueAt || null,
      });
      setTasks([task, ...tasks]);
      setTaskTitle('');
      setTaskDueAt('');
    } catch {
      alert('Error en guardar la tasca.');
    } finally {
      setSavingTask(false);
    }
  }

  async function toggleTask(task: Task) {
    const updated = await api.patch(`/api/tasks/${task.id}`, {
      status: task.status === 'open' ? 'done' : 'open',
    });
    setTasks(tasks.map((t) => (t.id === task.id ? { ...t, ...updated } : t)));
  }

  async function deleteTask(id: string) {
    if (!confirm('Eliminar aquesta tasca?')) return;
    await api.delete(`/api/tasks/${id}`);
    setTasks(tasks.filter((t) => t.id !== id));
  }

  const openTasks = tasks.filter((t) => t.status === 'open');
  const doneTasks = tasks.filter((t) => t.status === 'done');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Notes ── */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>Notes ({notes.length})</h3>

        {/* Add note */}
        <div style={{ marginBottom: 16 }}>
          <textarea
            placeholder="Afegir nota..."
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            rows={3}
            style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote();
            }}
          />
          <button
            onClick={addNote}
            disabled={!noteBody.trim() || savingNote}
            style={{ ...primaryBtn, marginTop: 6 }}
          >
            {savingNote ? 'Guardant...' : 'Afegir nota'}
          </button>
        </div>

        {/* List */}
        {loadingNotes ? (
          <div style={{ color: '#999', fontSize: 13 }}>Carregant...</div>
        ) : notes.length === 0 ? (
          <div style={{ color: '#bbb', fontSize: 13 }}>Cap nota encara.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {notes.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                objectType={objectType}
                objectId={objectId}
                onDelete={handleDeleteNote}
                onUpdate={handleUpdateNote}
                onReplyAdded={handleReplyAdded}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Tasks ── */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>
          Tasques ({openTasks.length} obertes
          {doneTasks.length > 0 ? `, ${doneTasks.length} fetes` : ''})
        </h3>

        {/* Add task */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            placeholder="Nova tasca..."
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 180 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTask();
            }}
          />
          <input
            type="datetime-local"
            value={taskDueAt}
            onChange={(e) => setTaskDueAt(e.target.value)}
            style={{ ...inputStyle, width: 180 }}
            title="Data límit (opcional)"
          />
          <button
            onClick={addTask}
            disabled={!taskTitle.trim() || savingTask}
            style={primaryBtn}
          >
            {savingTask ? '...' : 'Afegir'}
          </button>
        </div>

        {/* Open tasks */}
        {loadingTasks ? (
          <div style={{ color: '#999', fontSize: 13 }}>Carregant...</div>
        ) : tasks.length === 0 ? (
          <div style={{ color: '#bbb', fontSize: 13 }}>Cap tasca encara.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[...openTasks, ...doneTasks].map((t) => (
              <div key={t.id} style={{ ...taskRowStyle, opacity: t.status === 'done' ? 0.55 : 1 }}>
                <input
                  type="checkbox"
                  checked={t.status === 'done'}
                  onChange={() => toggleTask(t)}
                  style={{ flexShrink: 0, cursor: 'pointer', width: 16, height: 16 }}
                />
                <div style={{ flex: 1 }}>
                  <span
                    style={{
                      fontSize: 13,
                      textDecoration: t.status === 'done' ? 'line-through' : 'none',
                    }}
                  >
                    {t.title}
                  </span>
                  {t.dueAt && (
                    <span
                      style={{
                        fontSize: 11,
                        color: isDue(t.dueAt) && t.status === 'open' ? '#e74c3c' : '#aaa',
                        marginLeft: 8,
                      }}
                    >
                      📅 {fmtDate(t.dueAt)}
                    </span>
                  )}
                  {t.assigneeName && (
                    <span style={{ fontSize: 11, color: '#aaa', marginLeft: 8 }}>
                      👤 {t.assigneeName}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => deleteTask(t.id)}
                  style={ghostDangerBtn}
                  title="Eliminar tasca"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function isDue(dueAt: string) {
  return new Date(dueAt) < new Date();
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 10,
  padding: '20px 24px',
  border: '1px solid var(--color-border)',
};

const sectionTitle: React.CSSProperties = {
  margin: '0 0 14px',
  fontSize: 14,
  fontWeight: 700,
  color: '#555',
};

const noteStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: '#fafafa',
  borderRadius: 6,
  border: '1px solid var(--color-border)',
};

const replyNoteStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: '#f3f3f3',
  borderRadius: 5,
  border: '1px solid var(--color-border)',
  marginLeft: 16,
};

const taskRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--color-border)',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 5,
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

const primaryBtn: React.CSSProperties = {
  background: 'var(--color-primary)',
  color: '#fff',
  border: 'none',
  padding: '7px 14px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const ghostBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--color-border)',
  color: '#666',
  fontSize: 12,
  cursor: 'pointer',
  padding: '3px 8px',
  borderRadius: 5,
  fontFamily: 'inherit',
};

const ghostEditBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#bbb',
  fontSize: 14,
  cursor: 'pointer',
  padding: '0 2px',
  lineHeight: 1,
  fontFamily: 'inherit',
};

const ghostDangerBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#ccc',
  fontSize: 16,
  cursor: 'pointer',
  padding: '0 2px',
  lineHeight: 1,
  fontFamily: 'inherit',
};
