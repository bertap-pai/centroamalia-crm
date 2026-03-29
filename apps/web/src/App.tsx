import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import Layout from './components/Layout.js';
import LoginPage from './pages/LoginPage.js';
import ContactsListPage from './pages/ContactsListPage.js';
import ContactDetailPage from './pages/ContactDetailPage.js';
import DealsListPage from './pages/DealsListPage.js';
import DealDetailPage from './pages/DealDetailPage.js';
import './styles/globals.css';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 24, color: '#999' }}>Carregant...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/contacts"
            element={
              <ProtectedRoute>
                <ContactsListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/contacts/:id"
            element={
              <ProtectedRoute>
                <ContactDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/deals"
            element={
              <ProtectedRoute>
                <DealsListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/deals/:id"
            element={
              <ProtectedRoute>
                <DealDetailPage />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/contacts" replace />} />
          <Route path="*" element={<Navigate to="/contacts" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
