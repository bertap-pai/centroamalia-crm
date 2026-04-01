import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

interface Stage {
  id: string;
  name: string;
  slug: string;
  position: number;
  isClosedWon: boolean;
  isClosedLost: boolean;
  requiredFields: string[];
}

interface DealProp {
  id: string;
  key: string;
  label: string;
}

interface Pipeline {
  id: string;
  name: string;
  slug: string;
  position: number;
  defaultView: 'list' | 'kanban';
  stages: Stage[];
}

export default function AdminPipelinesPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // New pipeline form
  const [showNewPipeline, setShowNewPipeline] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [savingPipeline, setSavingPipeline] = useState(false);

  // Editing pipeline name inline
  const [editingPipelineId, setEditingPipelineId] = useState<string | null>(null);
  const [editingPipelineName, setEditingPipelineName] = useState('');

  // New stage form (per pipeline)
  const [addingStageForPipeline, setAddingStageForPipeline] = useState<string | null>(null);
  const [newStageName, setNewStageName] = useState('');
  const [newStageClosedWon, setNewStageClosedWon] = useState(false);
  const [newStageClosedLost, setNewStageClosedLost] = useState(false);
  const [savingStage, setSavingStage] = useState(false);

  // Editing stage inline
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingStageName, setEditingStageName] = useState('');
  const [editingStageClosedWon, setEditingStageClosedWon] = useState(false);
  const [editingStageClosedLost, setEditingStageClosedLost] = useState(false);
  const [editingStageRequiredFields, setEditingStageRequiredFields] = useState<string[]>([]);

  const [dealProps, setDealProps] = useState<DealProp[]>([]);

  // Confirm delete
  const [deletingPipelineId, setDeletingPipelineId] = useState<string | null>(null);
  const [deletingStageId, setDeletingStageId] = useState<string | null>(null);
  const [deletingStageForPipeline, setDeletingStageForPipeline] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([
      api.get('/api/pipelines'),
      api.get('/api/properties?scope=deal'),
    ])
      .then(([pipelineData, propData]) => {
        setPipelines(pipelineData);
        setDealProps(propData);
        setError('');
      })
      .catch(() => setError('Error carregant els pipelines.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  // ── Create pipeline ──────────────────────────────────────────────────────

  async function handleCreatePipeline(e: React.FormEvent) {
    e.preventDefault();
    if (!newPipelineName.trim()) return;
    setSavingPipeline(true);
    try {
      await api.post('/api/pipelines', { name: newPipelineName.trim() });
      setNewPipelineName('');
      setShowNewPipeline(false);
      load();
    } catch {
      setError('Error creant el pipeline.');
    } finally {
      setSavingPipeline(false);
    }
  }

  // ── Update pipeline name ─────────────────────────────────────────────────

  async function handleSavePipelineName(id: string) {
    if (!editingPipelineName.trim()) return;
    try {
      await api.patch(`/api/pipelines/${id}`, { name: editingPipelineName.trim() });
      setEditingPipelineId(null);
      load();
    } catch {
      setError('Error actualitzant el pipeline.');
    }
  }

  // ── Delete pipeline ──────────────────────────────────────────────────────

  async function handleDeletePipeline(id: string) {
    try {
      await api.delete(`/api/pipelines/${id}`);
      setDeletingPipelineId(null);
      load();
    } catch (err: any) {
      if (err?.data?.error === 'pipeline_has_deals') {
        setError(`No es pot eliminar: hi ha ${err.data.count} deal(s) en aquest pipeline.`);
      } else {
        setError('Error eliminant el pipeline.');
      }
      setDeletingPipelineId(null);
    }
  }

  // ── Create stage ─────────────────────────────────────────────────────────

  async function handleCreateStage(e: React.FormEvent, pipelineId: string) {
    e.preventDefault();
    if (!newStageName.trim()) return;
    setSavingStage(true);
    const pipeline = pipelines.find((p) => p.id === pipelineId);
    const nextPosition = pipeline ? pipeline.stages.length : 0;
    try {
      await api.post(`/api/pipelines/${pipelineId}/stages`, {
        name: newStageName.trim(),
        position: nextPosition,
        isClosedWon: newStageClosedWon,
        isClosedLost: newStageClosedLost,
      });
      setAddingStageForPipeline(null);
      setNewStageName('');
      setNewStageClosedWon(false);
      setNewStageClosedLost(false);
      load();
    } catch {
      setError('Error creant l\'etapa.');
    } finally {
      setSavingStage(false);
    }
  }

  // ── Set default view ────────────────────────────────────────────────────

  async function handleSetDefaultView(id: string, view: 'list' | 'kanban') {
    try {
      await api.patch(`/api/pipelines/${id}`, { defaultView: view });
      load();
    } catch {
      setError('Error actualitzant la vista per defecte.');
    }
  }

  // ── Move stage up/down ───────────────────────────────────────────────────

  async function handleMoveStage(pipeline: Pipeline, stageId: string, dir: 'up' | 'down') {
    const sorted = [...pipeline.stages].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const idx = sorted.findIndex((s) => s.id === stageId);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx]!;
    const b = sorted[swapIdx]!;
    try {
      await Promise.all([
        api.patch(`/api/pipelines/${pipeline.id}/stages/${a.id}`, { position: b.position }),
        api.patch(`/api/pipelines/${pipeline.id}/stages/${b.id}`, { position: a.position }),
      ]);
      load();
    } catch {
      setError('Error reordenant les etapes.');
    }
  }

  // ── Update stage ─────────────────────────────────────────────────────────

  async function handleSaveStage(pipelineId: string, stageId: string) {
    if (!editingStageName.trim()) return;
    try {
      await api.patch(`/api/pipelines/${pipelineId}/stages/${stageId}`, {
        name: editingStageName.trim(),
        isClosedWon: editingStageClosedWon,
        isClosedLost: editingStageClosedLost,
        requiredFields: editingStageRequiredFields,
      });
      setEditingStageId(null);
      load();
    } catch {
      setError('Error actualitzant l\'etapa.');
    }
  }

  // ── Delete stage ─────────────────────────────────────────────────────────

  async function handleDeleteStage(pipelineId: string, stageId: string) {
    try {
      await api.delete(`/api/pipelines/${pipelineId}/stages/${stageId}`);
      setDeletingStageId(null);
      setDeletingStageForPipeline(null);
      load();
    } catch (err: any) {
      if (err?.data?.error === 'stage_has_deals') {
        setError(`No es pot eliminar: hi ha ${err.data.count} deal(s) en aquesta etapa.`);
      } else {
        setError('Error eliminant l\'etapa.');
      }
      setDeletingStageId(null);
      setDeletingStageForPipeline(null);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) return <div style={{ padding: 32, color: '#999' }}>Carregant...</div>;

  return (
    <div style={{ padding: '28px 32px', maxWidth: 760 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Pipelines</h1>
        <button onClick={() => setShowNewPipeline(true)} style={primaryBtn}>
          + Nou pipeline
        </button>
      </div>

      {error && (
        <div style={{ background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 6, padding: '10px 14px', marginBottom: 16, color: '#c0392b', fontSize: 13 }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontWeight: 600 }}>×</button>
        </div>
      )}

      {/* New pipeline form */}
      {showNewPipeline && (
        <div style={cardStyle}>
          <form onSubmit={handleCreatePipeline} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              autoFocus
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder="Nom del pipeline (ex: Vendes)"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="submit" disabled={savingPipeline || !newPipelineName.trim()} style={primaryBtn}>
              {savingPipeline ? 'Guardant...' : 'Crear'}
            </button>
            <button type="button" onClick={() => { setShowNewPipeline(false); setNewPipelineName(''); }} style={secondaryBtn}>
              Cancel·lar
            </button>
          </form>
        </div>
      )}

      {pipelines.length === 0 && !showNewPipeline && (
        <div style={{ color: '#999', fontSize: 14, padding: '20px 0' }}>
          Encara no hi ha cap pipeline. Crea'n un amb el botó de dalt.
        </div>
      )}

      {pipelines.map((pipeline) => (
        <div key={pipeline.id} style={{ ...cardStyle, marginBottom: 16 }}>
          {/* Pipeline header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            {editingPipelineId === pipeline.id ? (
              <div style={{ display: 'flex', gap: 8, flex: 1 }}>
                <input
                  autoFocus
                  value={editingPipelineName}
                  onChange={(e) => setEditingPipelineName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSavePipelineName(pipeline.id);
                    if (e.key === 'Escape') setEditingPipelineId(null);
                  }}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button onClick={() => handleSavePipelineName(pipeline.id)} style={primaryBtn}>Guardar</button>
                <button onClick={() => setEditingPipelineId(null)} style={secondaryBtn}>Cancel·lar</button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                    {pipeline.name}
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#999', fontWeight: 400 }}>{pipeline.slug}</span>
                  </h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: '#888' }}>Vista per defecte:</span>
                    <select
                      value={pipeline.defaultView ?? 'list'}
                      onChange={(e) => handleSetDefaultView(pipeline.id, e.target.value as 'list' | 'kanban')}
                      style={{ fontSize: 12, padding: '3px 8px', border: '1px solid var(--color-border)', borderRadius: 5, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}
                    >
                      <option value="list">Llista</option>
                      <option value="kanban">Kanban</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => { setEditingPipelineId(pipeline.id); setEditingPipelineName(pipeline.name); }}
                    style={smallBtn}
                  >
                    Reanomenar
                  </button>
                  {deletingPipelineId === pipeline.id ? (
                    <>
                      <span style={{ fontSize: 12, color: '#c0392b', alignSelf: 'center' }}>Confirmar eliminació?</span>
                      <button onClick={() => handleDeletePipeline(pipeline.id)} style={dangerBtn}>Sí, eliminar</button>
                      <button onClick={() => setDeletingPipelineId(null)} style={secondaryBtn}>No</button>
                    </>
                  ) : (
                    <button onClick={() => setDeletingPipelineId(pipeline.id)} style={smallBtn}>
                      Eliminar
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Stages list */}
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8 }}>
              Etapes
            </div>

            {pipeline.stages.length === 0 && (
              <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Sense etapes</div>
            )}

            {[...pipeline.stages].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map((stage, idx, sorted) => (
              <div key={stage.id} style={stageRowStyle}>
                {editingStageId === stage.id ? (
                  <div style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      autoFocus
                      value={editingStageName}
                      onChange={(e) => setEditingStageName(e.target.value)}
                      style={{ ...inputStyle, width: 200 }}
                    />
                    <label style={checkLabel}>
                      <input
                        type="checkbox"
                        checked={editingStageClosedWon}
                        onChange={(e) => { setEditingStageClosedWon(e.target.checked); if (e.target.checked) setEditingStageClosedLost(false); }}
                      />
                      Tancat Guanyat
                    </label>
                    <label style={checkLabel}>
                      <input
                        type="checkbox"
                        checked={editingStageClosedLost}
                        onChange={(e) => { setEditingStageClosedLost(e.target.checked); if (e.target.checked) setEditingStageClosedWon(false); }}
                      />
                      Tancat Perdut
                    </label>
                    {dealProps.length > 0 && (
                      <div style={{ width: '100%', marginTop: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 4 }}>
                          Camps obligatoris per entrar en aquesta etapa:
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {dealProps.map((prop) => (
                            <label key={prop.key} style={checkLabel}>
                              <input
                                type="checkbox"
                                checked={editingStageRequiredFields.includes(prop.key)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setEditingStageRequiredFields((prev) => [...prev, prop.key]);
                                  } else {
                                    setEditingStageRequiredFields((prev) => prev.filter((k) => k !== prop.key));
                                  }
                                }}
                              />
                              {prop.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <button onClick={() => handleSaveStage(pipeline.id, stage.id)} style={primaryBtn}>Guardar</button>
                    <button onClick={() => setEditingStageId(null)} style={secondaryBtn}>Cancel·lar</button>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <button
                          onClick={() => handleMoveStage(pipeline, stage.id, 'up')}
                          disabled={idx === 0}
                          style={{ ...arrowBtn, opacity: idx === 0 ? 0.2 : 1 }}
                          title="Moure amunt"
                        >▲</button>
                        <button
                          onClick={() => handleMoveStage(pipeline, stage.id, 'down')}
                          disabled={idx === sorted.length - 1}
                          style={{ ...arrowBtn, opacity: idx === sorted.length - 1 ? 0.2 : 1 }}
                          title="Moure avall"
                        >▼</button>
                      </div>
                      <span style={{ fontSize: 13 }}>{stage.name}</span>
                      {stage.isClosedWon && <span style={badge('green')}>Guanyat</span>}
                      {stage.isClosedLost && <span style={badge('red')}>Perdut</span>}
                      {(stage.requiredFields ?? []).map((key) => {
                        const prop = dealProps.find((p) => p.key === key);
                        return (
                          <span key={key} style={badge('blue')}>
                            {prop?.label ?? key}
                          </span>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => {
                          setEditingStageId(stage.id);
                          setEditingStageName(stage.name);
                          setEditingStageClosedWon(stage.isClosedWon);
                          setEditingStageClosedLost(stage.isClosedLost);
                          setEditingStageRequiredFields(stage.requiredFields ?? []);
                        }}
                        style={smallBtn}
                      >
                        Editar
                      </button>
                      {deletingStageId === stage.id ? (
                        <>
                          <span style={{ fontSize: 11, color: '#c0392b', alignSelf: 'center' }}>Confirmar?</span>
                          <button onClick={() => handleDeleteStage(pipeline.id, stage.id)} style={dangerBtn}>Sí</button>
                          <button onClick={() => { setDeletingStageId(null); setDeletingStageForPipeline(null); }} style={secondaryBtn}>No</button>
                        </>
                      ) : (
                        <button
                          onClick={() => { setDeletingStageId(stage.id); setDeletingStageForPipeline(pipeline.id); }}
                          style={smallBtn}
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}

            {/* Add stage */}
            {addingStageForPipeline === pipeline.id ? (
              <form onSubmit={(e) => handleCreateStage(e, pipeline.id)} style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  autoFocus
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  placeholder="Nom de l'etapa"
                  style={{ ...inputStyle, width: 200 }}
                />
                <label style={checkLabel}>
                  <input
                    type="checkbox"
                    checked={newStageClosedWon}
                    onChange={(e) => { setNewStageClosedWon(e.target.checked); if (e.target.checked) setNewStageClosedLost(false); }}
                  />
                  Tancat Guanyat
                </label>
                <label style={checkLabel}>
                  <input
                    type="checkbox"
                    checked={newStageClosedLost}
                    onChange={(e) => { setNewStageClosedLost(e.target.checked); if (e.target.checked) setNewStageClosedWon(false); }}
                  />
                  Tancat Perdut
                </label>
                <button type="submit" disabled={savingStage || !newStageName.trim()} style={primaryBtn}>
                  {savingStage ? 'Guardant...' : 'Afegir'}
                </button>
                <button type="button" onClick={() => { setAddingStageForPipeline(null); setNewStageName(''); setNewStageClosedWon(false); setNewStageClosedLost(false); }} style={secondaryBtn}>
                  Cancel·lar
                </button>
              </form>
            ) : (
              <button
                onClick={() => setAddingStageForPipeline(pipeline.id)}
                style={{ marginTop: 6, background: 'none', border: '1px dashed #ccc', borderRadius: 5, padding: '5px 12px', fontSize: 12, color: '#888', cursor: 'pointer', width: '100%' }}
              >
                + Afegir etapa
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '16px 18px',
  marginBottom: 12,
};

const stageRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 0',
  borderBottom: '1px solid #f3f3f3',
};

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
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
  whiteSpace: 'nowrap',
};

const secondaryBtn: React.CSSProperties = {
  background: '#fff',
  color: '#555',
  border: '1px solid var(--color-border)',
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const smallBtn: React.CSSProperties = {
  background: 'none',
  color: '#666',
  border: '1px solid #ddd',
  padding: '4px 10px',
  borderRadius: 5,
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const dangerBtn: React.CSSProperties = {
  background: '#c0392b',
  color: '#fff',
  border: 'none',
  padding: '4px 10px',
  borderRadius: 5,
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const checkLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  color: '#555',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const arrowBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '1px 4px',
  fontSize: 9,
  color: '#888',
  lineHeight: 1,
};

function badge(color: 'green' | 'red' | 'blue'): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 10,
    background: color === 'green' ? '#e6f4ea' : color === 'red' ? '#fde8e8' : '#e8f0fe',
    color: color === 'green' ? '#2d7a3a' : color === 'red' ? '#c0392b' : '#1a56db',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  };
}
