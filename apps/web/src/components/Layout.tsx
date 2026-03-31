import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';

const SIDEBAR_W = 220;

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <nav
        style={{
          width: SIDEBAR_W,
          minWidth: SIDEBAR_W,
          background: '#1c1c1c',
          display: 'flex',
          flexDirection: 'column',
          padding: '0',
          color: '#fff',
        }}
      >
        {/* Logo */}
        <div
          style={{
            padding: '20px 16px 16px',
            borderBottom: '1px solid #333',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-primary)' }}>
            Centro Amalia
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>CRM</div>
        </div>

        {/* Nav */}
        <div style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
          <NavItem to="/contacts" label="Contactes" icon="👤" />
          <NavItem to="/deals" label="Deals" icon="💼" />
          <NavItem to="/tasks" label="Tasques" icon="✅" />
          <NavItem to="/forms" label="Formularis" icon="📋" />
          {user?.role === 'admin' && (
            <>
              <div style={{ margin: '12px 10px 6px', fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Admin
              </div>
              <NavItem to="/admin/users" label="Usuaris" icon="👥" />
              <NavItem to="/admin/pipelines" label="Pipelines" icon="🔀" />
              <NavItem to="/admin/properties" label="Propietats" icon="⚙️" />
              <NavItem to="/admin/import" label="Importació" icon="📥" />
              <NavItem to="/admin/export" label="Exportació" icon="📤" />
            </>
          )}
        </div>

        {/* User */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid #333',
            fontSize: 12,
          }}
        >
          <div style={{ color: '#ccc', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.name ?? user?.email}
          </div>
          <div style={{ color: '#666', fontSize: 11, marginBottom: 8 }}>
            {user?.role === 'admin' ? 'Administrador/a' : 'Usuari/a'}
          </div>
          <button
            onClick={handleLogout}
            style={{
              background: 'none',
              border: '1px solid #444',
              color: '#999',
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 11,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            Tancar sessió
          </button>
        </div>
      </nav>

      {/* Main */}
      <main style={{ flex: 1, overflow: 'auto', background: 'var(--color-bg)' }}>
        {children}
      </main>
    </div>
  );
}

function NavItem({ to, label, icon, disabled }: { to: string; label: string; icon: string; disabled?: boolean }) {
  const base: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    color: '#ccc',
    textDecoration: 'none',
    marginBottom: 2,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
  };

  if (disabled) {
    return (
      <div style={base}>
        <span>{icon}</span> {label}
      </div>
    );
  }

  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        ...base,
        background: isActive ? 'rgba(232, 125, 82, 0.18)' : 'transparent',
        color: isActive ? 'var(--color-primary)' : '#ccc',
      })}
    >
      <span>{icon}</span> {label}
    </NavLink>
  );
}
