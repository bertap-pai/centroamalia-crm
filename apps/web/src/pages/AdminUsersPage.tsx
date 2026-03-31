import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  createdAt: string;
}

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.get('/api/admin/users')
      .then((data) => { setUsers(data); setError(''); })
      .catch(() => setError('Error carregant els usuaris.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleRoleChange(userId: string, newRole: 'admin' | 'user') {
    setSaving(userId);
    try {
      await api.patch(`/api/admin/users/${userId}`, { role: newRole });
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)),
      );
    } catch (err: any) {
      if (err?.data?.error === 'cannot_demote_self') {
        setError('No et pots treure el rol d\'admin a tu mateix.');
      } else {
        setError('Error actualitzant el rol.');
      }
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <div style={{ padding: 32, color: '#999' }}>Carregant...</div>;

  return (
    <div style={{ padding: '28px 32px', maxWidth: 700 }}>
      <h1 style={{ margin: '0 0 24px', fontSize: 20, fontWeight: 700 }}>Usuaris</h1>

      {error && (
        <div style={{ background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 6, padding: '10px 14px', marginBottom: 16, color: '#c0392b', fontSize: 13 }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontWeight: 600 }}>×</button>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#fafafa', borderBottom: '1px solid var(--color-border)' }}>
              <th style={th}>Nom</th>
              <th style={th}>Email</th>
              <th style={th}>Rol</th>
              <th style={th}>Creat</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid #f3f3f3' }}>
                <td style={td}>
                  {u.name}
                  {u.id === currentUser?.id && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: '#999', fontWeight: 600 }}>TU</span>
                  )}
                </td>
                <td style={{ ...td, color: '#666' }}>{u.email}</td>
                <td style={td}>
                  <select
                    value={u.role}
                    disabled={saving === u.id || u.id === currentUser?.id}
                    onChange={(e) => handleRoleChange(u.id, e.target.value as 'admin' | 'user')}
                    style={{
                      padding: '4px 8px',
                      border: '1px solid var(--color-border)',
                      borderRadius: 5,
                      fontSize: 12,
                      background: '#fff',
                      cursor: u.id === currentUser?.id ? 'not-allowed' : 'pointer',
                      opacity: u.id === currentUser?.id ? 0.6 : 1,
                    }}
                  >
                    <option value="admin">Admin</option>
                    <option value="user">Usuari</option>
                  </select>
                  {saving === u.id && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#999' }}>Guardant...</span>
                  )}
                </td>
                <td style={{ ...td, color: '#999', fontSize: 12 }}>
                  {new Date(u.createdAt).toLocaleDateString('ca-ES')}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '20px 16px', color: '#bbb', textAlign: 'center' }}>
                  Sense usuaris
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 12, fontSize: 12, color: '#999' }}>
        El teu propi rol no es pot modificar des d'aquí — demana a un altre admin si cal.
      </p>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '10px 16px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 700,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
};

const td: React.CSSProperties = {
  padding: '10px 16px',
  verticalAlign: 'middle',
};
