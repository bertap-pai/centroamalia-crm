import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import LoginPage from './pages/LoginPage.js';
import './styles/globals.css';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 24 }}>Carregant...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function HomePage() {
  const { user, logout } = useAuth();
  return (
    <div style={{ padding: 32 }}>
      <h2 style={{ fontWeight: 700, marginTop: 0 }}>Benvingut/da, {user?.name}</h2>
      <p style={{ color: 'var(--color-text-muted)' }}>CRM Centro Amalia — en construcció</p>
      <button
        onClick={logout}
        style={{
          marginTop: 16,
          padding: '8px 16px',
          background: 'var(--color-primary)',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        Tancar sessió
      </button>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
