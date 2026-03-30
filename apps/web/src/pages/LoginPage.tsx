import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { BASE_PATH } from '../lib/base-path.js';

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'El teu compte no té accés a aquesta aplicació.',
  oauth_failed: "Error d'autenticació amb Google. Torna-ho a intentar.",
  profile_failed: "No s'ha pogut obtenir el perfil de Google. Torna-ho a intentar.",
  server_error: 'Error intern del servidor. Contacta amb l\'administrador.',
};

export default function LoginPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  useEffect(() => {
    if (!loading && user) {
      navigate('/', { replace: true });
    }
  }, [user, loading, navigate]);

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <span style={styles.logoMark}>CA</span>
        </div>
        <h1 style={styles.title}>Centro Amalia CRM</h1>
        <p style={styles.subtitle}>Gestió de contactes i tractes</p>

        {error && (
          <div style={styles.errorBox}>
            {ERROR_MESSAGES[error] ?? 'Error desconegut.'}
          </div>
        )}

        <a href={`${BASE_PATH}/auth/google`} style={styles.googleBtn}>
          <GoogleIcon />
          <span>Inicia sessió amb Google</span>
        </a>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-bg)',
    padding: '24px',
  },
  card: {
    background: 'var(--color-surface)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow-md)',
    padding: '48px 40px',
    width: '100%',
    maxWidth: '400px',
    textAlign: 'center' as const,
  },
  logo: {
    marginBottom: '20px',
  },
  logoMark: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '56px',
    height: '56px',
    borderRadius: '14px',
    background: 'var(--color-primary)',
    color: '#fff',
    fontSize: '20px',
    fontWeight: 700,
    letterSpacing: '0.05em',
  },
  title: {
    margin: '0 0 8px',
    fontSize: '22px',
    fontWeight: 700,
    color: 'var(--color-text)',
  },
  subtitle: {
    margin: '0 0 32px',
    color: 'var(--color-text-muted)',
    fontSize: '14px',
  },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    color: 'var(--color-error)',
    padding: '12px 16px',
    marginBottom: '20px',
    fontSize: '13px',
    textAlign: 'left' as const,
  },
  googleBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '12px',
    background: '#fff',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--color-text)',
    cursor: 'pointer',
    textDecoration: 'none',
    boxShadow: 'var(--shadow-sm)',
    transition: 'box-shadow 0.15s',
    width: '100%',
    justifyContent: 'center',
  },
};
