import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';

type FieldType = 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox' | 'static_text';

interface FieldOption {
  key: string;
  label: string;
}

interface FormField {
  id?: string;
  key: string;
  label: string;
  type: FieldType;
  placeholder: string;
  isRequired: boolean;
  isVisible: boolean;
  position: number;
  options: FieldOption[];
  crmPropertyKey: string;
}

interface FormData {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  submitLabel: string;
  successMessage: string;
  buttonStyle: {
    background: string;
    color: string;
    borderRadius: number;
    fontSize: number;
  };
  fields: FormField[];
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text curt',
  email: 'Email',
  phone: 'Telèfon',
  textarea: 'Text llarg',
  select: 'Desplegable',
  checkbox: 'Casella',
  static_text: 'Text estàtic',
};

function getOption(options: FieldOption[], key: string, fallback: string): string {
  return options.find((o) => o.key === key)?.label ?? fallback;
}


function makeKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[àáâä]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôö]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/ç/g, 'c').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'camp';
}

function newField(position: number): FormField {
  return {
    key: `camp_${position + 1}`,
    label: '',
    type: 'text',
    placeholder: '',
    isRequired: false,
    isVisible: true,
    position,
    options: [],
    crmPropertyKey: '',
  };
}

export default function FormEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [form, setForm] = useState<FormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [selectedFieldIdx, setSelectedFieldIdx] = useState<number | null>(null);
  const [tab, setTab] = useState<'editor' | 'preview' | 'embed'>('editor');
  const [crmProperties, setCrmProperties] = useState<Array<{ key: string; label: string; group: string }>>([]);

  useEffect(() => {
    const CORE_CONTACT_FIELDS = [
      { key: 'firstName', label: 'Nom', group: 'Contacte (bàsic)' },
      { key: 'lastName', label: 'Cognom', group: 'Contacte (bàsic)' },
      { key: 'email', label: 'Email', group: 'Contacte (bàsic)' },
      { key: 'phone', label: 'Telèfon', group: 'Contacte (bàsic)' },
    ];

    api.get('/api/properties?scope=contact')
      .then((data: Array<{ key: string; label: string }>) => {
        const contactProps = data
          .map((p) => ({ key: p.key, label: p.label, group: 'Propietats contacte' }));
        setCrmProperties([
          { key: '', label: '— No mapejat —', group: '' },
          ...CORE_CONTACT_FIELDS,
          ...contactProps,
        ]);
      })
      .catch(() => {/* silently ignore — mapping dropdown will be empty */});
  }, []);

  useEffect(() => {
    if (!id) return;
    api.get(`/api/forms/${id}`)
      .then((data) => {
        setForm({
          ...data,
          description: data.description ?? '',
          buttonStyle: data.buttonStyle ?? { background: '#e87d52', color: '#ffffff', borderRadius: 6, fontSize: 14 },
          fields: (data.fields ?? []).map((f: any) => ({
            ...f,
            placeholder: f.placeholder ?? '',
            options: f.options ?? [],
            crmPropertyKey: f.crmPropertyKey ?? '',
            isVisible: f.isVisible ?? true,
          })),
        });
      })
      .catch(() => setError('Error carregant el formulari.'))
      .finally(() => setLoading(false));
  }, [id]);

  const save = useCallback(async (f: FormData) => {
    setSaving(true);
    setError('');
    try {
      const updated = await api.put(`/api/forms/${f.id}`, {
        name: f.name,
        description: f.description || null,
        status: f.status,
        submitLabel: f.submitLabel,
        successMessage: f.successMessage,
        buttonStyle: f.buttonStyle,
        fields: f.fields.map((field, idx) => ({ ...field, position: idx })),
      });
      setForm({
        ...updated,
        description: updated.description ?? '',
        buttonStyle: updated.buttonStyle ?? { background: '#e87d52', color: '#ffffff', borderRadius: 6, fontSize: 14 },
        fields: (updated.fields ?? []).map((fl: any) => ({
          ...fl,
          placeholder: fl.placeholder ?? '',
          options: fl.options ?? [],
          crmPropertyKey: fl.crmPropertyKey ?? '',
          isVisible: fl.isVisible ?? true,
        })),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Error guardant els canvis.');
    } finally {
      setSaving(false);
    }
  }, []);

  function updateField(idx: number, changes: Partial<FormField>) {
    if (!form) return;
    const fields = form.fields.map((f, i) => i === idx ? { ...f, ...changes } : f);
    setForm({ ...form, fields });
  }

  function addField() {
    if (!form) return;
    const field = newField(form.fields.length);
    const fields = [...form.fields, field];
    setForm({ ...form, fields });
    setSelectedFieldIdx(fields.length - 1);
  }

  function removeField(idx: number) {
    if (!form) return;
    const fields = form.fields.filter((_, i) => i !== idx);
    setForm({ ...form, fields });
    setSelectedFieldIdx(null);
  }

  function moveField(idx: number, dir: -1 | 1) {
    if (!form) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= form.fields.length) return;
    const fields = [...form.fields];
    [fields[idx], fields[newIdx]] = [fields[newIdx]!, fields[idx]!];
    setForm({ ...form, fields });
    setSelectedFieldIdx(newIdx);
  }

  if (loading) return <div style={{ padding: 32, color: '#999' }}>Carregant...</div>;
  if (!form) return <div style={{ padding: 32, color: '#c0392b' }}>Formulari no trobat.</div>;

  const embedUrl = `${window.location.origin}/crm/forms/embed/${form.id}`;
  const jsSnippet = `<div id="ca-form-${form.id}"></div>
<script>
(function() {
  var TRACKING_KEYS = ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","fbclid","gclid","msclid","ttclid"];
  var pageParams = new URLSearchParams(window.location.search);
  var fwd = new URLSearchParams();
  TRACKING_KEYS.forEach(function(k) { var v = pageParams.get(k); if (v) fwd.set(k, v); });
  var base = "${embedUrl}";
  var src = fwd.toString() ? base + "?" + fwd.toString() : base;
  var iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.width = "100%";
  iframe.height = "600";
  iframe.setAttribute("frameborder", "0");
  iframe.style.border = "none";
  document.getElementById("ca-form-${form.id}").appendChild(iframe);
  window.addEventListener("message", function(e) {
    if (e.data && typeof e.data.height === "number") {
      iframe.style.height = e.data.height + "px";
    }
  });
})();
</script>`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--color-border)', background: '#fff', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        <button onClick={() => navigate('/forms')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 13 }}>
          ← Formularis
        </button>
        <div style={{ flex: 1 }}>
          {isAdmin ? (
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              style={{ fontSize: 16, fontWeight: 700, border: 'none', outline: 'none', width: '100%', background: 'transparent' }}
            />
          ) : (
            <span style={{ fontSize: 16, fontWeight: 700 }}>{form.name}</span>
          )}
        </div>
        <select
          value={form.status}
          disabled={!isAdmin}
          onChange={(e) => setForm({ ...form, status: e.target.value as FormData['status'] })}
          style={{ padding: '5px 10px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 12, cursor: isAdmin ? 'pointer' : 'not-allowed' }}
        >
          <option value="draft">Esborrany</option>
          <option value="active">Actiu</option>
          <option value="paused">Pausat</option>
          <option value="archived">Arxivat</option>
        </select>
        {isAdmin && (
          <button
            onClick={() => save(form)}
            disabled={saving}
            style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Guardant...' : saved ? '✓ Guardat' : 'Guardar'}
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: '#fff1f0', border: '1px solid #ffa39e', padding: '10px 24px', color: '#c0392b', fontSize: 13 }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontWeight: 600 }}>×</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid var(--color-border)', background: '#fff', padding: '0 24px', display: 'flex', gap: 0, flexShrink: 0 }}>
        {(['editor', 'preview', 'embed'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none', border: 'none', padding: '10px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              color: tab === t ? 'var(--color-primary)' : '#666',
              borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t === 'editor' ? 'Editor' : t === 'preview' ? 'Previsualització' : 'Embed'}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'editor' && (
          <div style={{ display: 'flex', height: '100%' }}>
            {/* Fields list */}
            <div style={{ width: 340, borderRight: '1px solid var(--color-border)', padding: 20, overflowY: 'auto', background: '#fafafa' }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14, color: '#444' }}>Camps del formulari</div>
              <div
                onClick={() => setSelectedFieldIdx(null)}
                style={{
                  background: selectedFieldIdx === null ? '#fff3ee' : '#fff',
                  border: `1px solid ${selectedFieldIdx === null ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  borderRadius: 6,
                  padding: '10px 12px',
                  marginBottom: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 14 }}>⚙</span>
                <div style={{ flex: 1, fontWeight: 500, fontSize: 13, color: '#444' }}>Configuració del formulari</div>
              </div>
              {form.fields.map((field, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedFieldIdx(idx === selectedFieldIdx ? null : idx)}
                  style={{
                    background: selectedFieldIdx === idx ? '#fff3ee' : '#fff',
                    border: `1px solid ${selectedFieldIdx === idx ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    borderRadius: 6,
                    padding: '10px 12px',
                    marginBottom: 8,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 11, color: '#bbb', minWidth: 20 }}>{idx + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {field.label || <span style={{ color: '#bbb' }}>Camp sense nom</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#999' }}>{FIELD_TYPE_LABELS[field.type]}</div>
                  </div>
                  {isAdmin && (
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button onClick={(e) => { e.stopPropagation(); moveField(idx, -1); }} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'not-allowed' : 'pointer', color: '#aaa', padding: '2px 4px', opacity: idx === 0 ? 0.3 : 1 }}>↑</button>
                      <button onClick={(e) => { e.stopPropagation(); moveField(idx, 1); }} disabled={idx === form.fields.length - 1} style={{ background: 'none', border: 'none', cursor: idx === form.fields.length - 1 ? 'not-allowed' : 'pointer', color: '#aaa', padding: '2px 4px', opacity: idx === form.fields.length - 1 ? 0.3 : 1 }}>↓</button>
                      <button onClick={(e) => { e.stopPropagation(); removeField(idx); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e74c3c', padding: '2px 4px', fontSize: 13 }}>×</button>
                    </div>
                  )}
                </div>
              ))}
              {isAdmin && (
                <button
                  onClick={addField}
                  style={{ width: '100%', padding: '10px', border: '1px dashed var(--color-border)', borderRadius: 6, background: 'none', cursor: 'pointer', color: '#888', fontSize: 13, marginTop: 4 }}
                >
                  + Afegir camp
                </button>
              )}
            </div>

            {/* Field properties panel */}
            <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
              {selectedFieldIdx !== null && form.fields[selectedFieldIdx] ? (
                <FieldPropertiesPanel
                  field={form.fields[selectedFieldIdx]!}
                  isAdmin={isAdmin}
                  crmProperties={crmProperties}
                  onChange={(changes) => updateField(selectedFieldIdx, changes)}
                />
              ) : (
                <div>
                  {/* Form settings */}
                  <div style={{ marginBottom: 32, maxWidth: 540 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16, color: '#333' }}>Configuració general</div>
                    <Label>Descripció</Label>
                    <textarea
                      value={form.description}
                      disabled={!isAdmin}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      rows={2}
                      style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
                      placeholder="Descripció opcional del formulari"
                    />
                    <Label>Text del botó d'enviament</Label>
                    <input
                      value={form.submitLabel}
                      disabled={!isAdmin}
                      onChange={(e) => setForm({ ...form, submitLabel: e.target.value })}
                      style={{ ...inputStyle, width: '100%' }}
                    />
                    <Label>Missatge de confirmació</Label>
                    <textarea
                      value={form.successMessage}
                      disabled={!isAdmin}
                      onChange={(e) => setForm({ ...form, successMessage: e.target.value })}
                      rows={3}
                      style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
                    />

                    <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--color-border)' }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16, color: '#333' }}>Botó d'enviament</div>

                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
                        <div>
                          <Label>Color de fons</Label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="color"
                              value={form.buttonStyle.background}
                              disabled={!isAdmin}
                              onChange={(e) => setForm({ ...form, buttonStyle: { ...form.buttonStyle, background: e.target.value } })}
                              style={{ width: 40, height: 32, padding: 2, border: '1px solid var(--color-border)', borderRadius: 4, cursor: isAdmin ? 'pointer' : 'not-allowed' }}
                            />
                            <span style={{ fontSize: 12, color: '#888' }}>{form.buttonStyle.background}</span>
                          </div>
                        </div>

                        <div>
                          <Label>Color del text</Label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="color"
                              value={form.buttonStyle.color}
                              disabled={!isAdmin}
                              onChange={(e) => setForm({ ...form, buttonStyle: { ...form.buttonStyle, color: e.target.value } })}
                              style={{ width: 40, height: 32, padding: 2, border: '1px solid var(--color-border)', borderRadius: 4, cursor: isAdmin ? 'pointer' : 'not-allowed' }}
                            />
                            <span style={{ fontSize: 12, color: '#888' }}>{form.buttonStyle.color}</span>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
                        <div>
                          <Label>Arrodoniment (px)</Label>
                          <input
                            type="number"
                            min={0}
                            max={50}
                            value={form.buttonStyle.borderRadius}
                            disabled={!isAdmin}
                            onChange={(e) => setForm({ ...form, buttonStyle: { ...form.buttonStyle, borderRadius: Number(e.target.value) } })}
                            style={{ ...inputStyle, width: 80 }}
                          />
                        </div>

                        <div>
                          <Label>Mida de lletra (px)</Label>
                          <input
                            type="number"
                            min={10}
                            max={24}
                            value={form.buttonStyle.fontSize}
                            disabled={!isAdmin}
                            onChange={(e) => setForm({ ...form, buttonStyle: { ...form.buttonStyle, fontSize: Number(e.target.value) } })}
                            style={{ ...inputStyle, width: 80 }}
                          />
                        </div>
                      </div>

                      <Label>Previsualització</Label>
                      <button
                        disabled
                        style={{
                          background: form.buttonStyle.background,
                          color: form.buttonStyle.color,
                          border: 'none',
                          borderRadius: form.buttonStyle.borderRadius,
                          padding: '11px 24px',
                          fontSize: form.buttonStyle.fontSize,
                          fontWeight: 600,
                          cursor: 'not-allowed',
                          opacity: 0.9,
                        }}
                      >
                        {form.submitLabel || 'Enviar'}
                      </button>
                    </div>
                  </div>
                  <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
                    Selecciona un camp per editar-lo
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'preview' && (
          <div style={{ padding: 32, maxWidth: 540, margin: '0 auto' }}>
            <FormPreview form={form} />
          </div>
        )}

        {tab === 'embed' && (
          <div style={{ padding: 32, maxWidth: 660 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Codi d'incrustació (iframe)</div>
            <div style={{ background: '#1c1c1c', color: '#e6db74', fontFamily: 'monospace', fontSize: 13, padding: 16, borderRadius: 8, wordBreak: 'break-all', marginBottom: 16 }}>
              {jsSnippet}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(jsSnippet)}
              style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 24 }}
            >
              Copiar codi
            </button>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>URL directa:</div>
            <a href={embedUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--color-primary)' }}>{embedUrl}</a>
            {form.status !== 'active' && (
              <div style={{ marginTop: 16, padding: '10px 14px', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6, fontSize: 13, color: '#856404' }}>
                El formulari no és <strong>actiu</strong> — canvia l'estat a "Actiu" perquè l'embed funcioni públicament.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FieldPropertiesPanel({ field, isAdmin, crmProperties, onChange }: {
  field: FormField;
  isAdmin: boolean;
  crmProperties: Array<{ key: string; label: string; group: string }>;
  onChange: (changes: Partial<FormField>) => void;
}) {
  function handleLabelChange(label: string) {
    const autoKey = makeKey(label);
    onChange({ label, key: autoKey });
  }

  return (
    <div style={{ maxWidth: 460 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 20, color: '#333' }}>Propietats del camp</div>

      <Label>Etiqueta *</Label>
      <input
        value={field.label}
        disabled={!isAdmin}
        onChange={(e) => handleLabelChange(e.target.value)}
        style={{ ...inputStyle, width: '100%' }}
        placeholder="Ex: El teu nom"
      />

      <Label>Clau interna</Label>
      <input
        value={field.key}
        disabled={!isAdmin}
        onChange={(e) => onChange({ key: e.target.value })}
        style={{ ...inputStyle, width: '100%', fontFamily: 'monospace', fontSize: 12 }}
        placeholder="nom_camp"
      />

      <Label>Tipus de camp</Label>
      <select
        value={field.type}
        disabled={!isAdmin}
        onChange={(e) => onChange({ type: e.target.value as FieldType })}
        style={{ ...inputStyle, width: '100%' }}
      >
        {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((t) => (
          <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>
        ))}
      </select>

      {(field.type !== 'checkbox' && field.type !== 'static_text') && (
        <>
          <Label>Placeholder</Label>
          <input
            value={field.placeholder}
            disabled={!isAdmin}
            onChange={(e) => onChange({ placeholder: e.target.value })}
            style={{ ...inputStyle, width: '100%' }}
            placeholder="Text d'ajuda"
          />
        </>
      )}

      {field.type === 'select' && (
        <SelectOptionsEditor
          options={field.options}
          isAdmin={isAdmin}
          onChange={(options) => onChange({ options })}
        />
      )}

      {field.type === 'static_text' ? (
        <div style={{ marginTop: 16 }}>
          <Label>Mida del text</Label>
          <select
            value={getOption(field.options, 'preset', 'normal')}
            disabled={!isAdmin}
            onChange={(e) => {
              const updated = field.options.filter((o) => o.key !== 'preset');
              onChange({ options: [...updated, { key: 'preset', label: e.target.value }] });
            }}
            style={{ ...inputStyle, width: '100%' }}
          >
            <option value="normal">Normal</option>
            <option value="heading">Títol (gran)</option>
            <option value="caption">Subtítol (petit)</option>
          </select>

          <Label>Color del text</Label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              value={getOption(field.options, 'color', '#333333')}
              disabled={!isAdmin}
              onChange={(e) => {
                const updated = field.options.filter((o) => o.key !== 'color');
                onChange({ options: [...updated, { key: 'color', label: e.target.value }] });
              }}
              style={{ width: 40, height: 32, padding: 2, border: '1px solid var(--color-border)', borderRadius: 4, cursor: isAdmin ? 'pointer' : 'not-allowed' }}
            />
            <span style={{ fontSize: 12, color: '#888' }}>{getOption(field.options, 'color', '#333333')}</span>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <input
              type="checkbox"
              id="required"
              checked={field.isRequired}
              disabled={!isAdmin}
              onChange={(e) => onChange({ isRequired: e.target.checked })}
              style={{ width: 16, height: 16, cursor: isAdmin ? 'pointer' : 'not-allowed' }}
            />
            <label htmlFor="required" style={{ fontSize: 13, color: '#444', cursor: isAdmin ? 'pointer' : 'default' }}>
              Camp obligatori
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <input
              type="checkbox"
              id="visible"
              checked={field.isVisible}
              disabled={!isAdmin}
              onChange={(e) => onChange({ isVisible: e.target.checked })}
              style={{ width: 16, height: 16, cursor: isAdmin ? 'pointer' : 'not-allowed' }}
            />
            <label htmlFor="visible" style={{ fontSize: 13, color: '#444', cursor: isAdmin ? 'pointer' : 'default' }}>
              Visible per al client
            </label>
          </div>

          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--color-border)' }}>
            <Label>Mapatge CRM</Label>
            <select
              value={field.crmPropertyKey}
              disabled={!isAdmin}
              onChange={(e) => onChange({ crmPropertyKey: e.target.value })}
              style={{ ...inputStyle, width: '100%' }}
            >
              {(() => {
                const grouped = crmProperties.reduce<Record<string, typeof crmProperties>>((acc, p) => {
                  (acc[p.group] = acc[p.group] ?? []).push(p);
                  return acc;
                }, {});
                return Object.entries(grouped).map(([group, opts]) =>
                  group ? (
                    <optgroup key={group} label={group}>
                      {opts.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </optgroup>
                  ) : (
                    opts.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)
                  )
                );
              })()}
            </select>
            <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
              Vincular el valor d'aquest camp a un atribut del contacte al CRM.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SelectOptionsEditor({ options, isAdmin, onChange }: {
  options: FieldOption[];
  isAdmin: boolean;
  onChange: (opts: FieldOption[]) => void;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <Label>Opcions del desplegable</Label>
      {options.map((opt, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            value={opt.label}
            disabled={!isAdmin}
            onChange={(e) => {
              const updated = options.map((o, i) => i === idx ? { ...o, label: e.target.value, key: makeKey(e.target.value) } : o);
              onChange(updated);
            }}
            style={{ ...inputStyle, flex: 1 }}
            placeholder={`Opció ${idx + 1}`}
          />
          {isAdmin && (
            <button onClick={() => onChange(options.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e74c3c', fontSize: 16 }}>×</button>
          )}
        </div>
      ))}
      {isAdmin && (
        <button
          onClick={() => onChange([...options, { key: `opcio_${options.length + 1}`, label: '' }])}
          style={{ fontSize: 12, color: '#888', background: 'none', border: '1px dashed var(--color-border)', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', marginTop: 4 }}
        >
          + Afegir opció
        </button>
      )}
    </div>
  );
}

function FormPreview({ form }: { form: FormData }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, padding: 28 }}>
      {form.description && <p style={{ margin: '0 0 24px', color: '#666', fontSize: 14 }}>{form.description}</p>}
      {form.fields.filter((f) => f.isVisible).map((field, idx) => (
        <div key={idx} style={{ marginBottom: 18 }}>
          {field.type !== 'static_text' && field.type !== 'checkbox' && (
            <label style={{ display: 'block', fontWeight: 500, fontSize: 13, color: '#333', marginBottom: 6 }}>
              {field.label || `Camp ${idx + 1}`}
              {field.isRequired && <span style={{ color: 'var(--color-primary)', marginLeft: 3 }}>*</span>}
            </label>
          )}
          {field.type === 'static_text' ? (() => {
            const preset = getOption(field.options, 'preset', 'normal');
            const color = getOption(field.options, 'color', '#333');
            if (preset === 'heading') return <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color }}>{field.label || `Camp ${idx + 1}`}</h2>;
            if (preset === 'caption') return <p style={{ margin: '0 0 4px', fontSize: 12, color, opacity: 0.75 }}>{field.label || `Camp ${idx + 1}`}</p>;
            return <p style={{ margin: '0 0 4px', fontSize: 14, color }}>{field.label || `Camp ${idx + 1}`}</p>;
          })() : field.type === 'textarea' ? (
            <textarea
              placeholder={field.placeholder}
              rows={4}
              style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
              disabled
            />
          ) : field.type === 'select' ? (
            <select style={{ ...inputStyle, width: '100%' }} disabled>
              <option value="">{field.placeholder || 'Selecciona una opció'}</option>
              {field.options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          ) : field.type === 'checkbox' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" disabled />
              <span style={{ fontSize: 13, color: '#555' }}>{field.placeholder || field.label}</span>
              {field.isRequired && <span style={{ color: 'var(--color-primary)', marginLeft: 3 }}>*</span>}
            </div>
          ) : (
            <input
              type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
              placeholder={field.placeholder}
              style={{ ...inputStyle, width: '100%' }}
              disabled
            />
          )}
        </div>
      ))}
      <button
        disabled
        style={{
          background: form.buttonStyle?.background ?? 'var(--color-primary)',
          color: form.buttonStyle?.color ?? '#fff',
          border: 'none',
          borderRadius: form.buttonStyle?.borderRadius ?? 6,
          padding: '10px 20px',
          fontSize: form.buttonStyle?.fontSize ?? 14,
          fontWeight: 600,
          cursor: 'not-allowed',
          opacity: 0.85,
          marginTop: 8,
        }}
      >
        {form.submitLabel}
      </button>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 5, marginTop: 14 }}>{children}</div>;
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  fontSize: 13,
  background: '#fff',
  boxSizing: 'border-box',
};
