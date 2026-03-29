import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Note {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
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
      setNotes([note, ...notes]);
      setNoteBody('');
    } catch {
      alert('Error en guardar la nota.');
    } finally {
      setSavingNote(false);
    }
  }

  async function deleteNote(id: string) {
    if (!confirm('Eliminar aquesta nota?')) return;
    await api.delete(`/api/notes/${id}`);
    setNotes(notes.filter((n) => n.id !== id));
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
              <div key={n.id} style={noteStyle}>
                <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{n.body}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: '#aaa' }}>
                    {n.authorName ?? 'Usuari'} · {fmtDateTime(n.createdAt)}
                  </span>
                  <button
                    onClick={() => deleteNote(n.id)}
                    style={ghostDangerBtn}
                    title="Eliminar nota"
                  >
                    ×
                  </button>
                </div>
              </div>
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
