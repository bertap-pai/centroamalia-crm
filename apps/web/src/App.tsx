import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { BASE_PATH } from './lib/base-path.js';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import Layout from './components/Layout.js';
import LoginPage from './pages/LoginPage.js';
import ContactsListPage from './pages/ContactsListPage.js';
import ContactDetailPage from './pages/ContactDetailPage.js';
import DealsListPage from './pages/DealsListPage.js';
import DealDetailPage from './pages/DealDetailPage.js';
import AdminPropertiesPage from './pages/AdminPropertiesPage.js';
import AdminPipelinesPage from './pages/AdminPipelinesPage.js';
import AdminUsersPage from './pages/AdminUsersPage.js';
import AdminImportPage from './pages/AdminImportPage.js';
import AdminExportPage from './pages/AdminExportPage.js';
import './styles/globals.css';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 24, color: '#999' }}>Carregant...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 24, color: '#999' }}>Carregant...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/contacts" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <BrowserRouter basename={BASE_PATH || '/'}>
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
          <Route
            path="/admin/users"
            element={
              <AdminRoute>
                <AdminUsersPage />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/pipelines"
            element={
              <AdminRoute>
                <AdminPipelinesPage />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/properties"
            element={
              <AdminRoute>
                <AdminPropertiesPage />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/import"
            element={
              <AdminRoute>
                <AdminImportPage />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/export"
            element={
              <AdminRoute>
                <AdminExportPage />
              </AdminRoute>
            }
          />
          <Route path="/" element={<Navigate to="/contacts" replace />} />
          <Route path="*" element={<Navigate to="/contacts" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
