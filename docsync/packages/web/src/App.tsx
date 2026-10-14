import { useEffect, useState } from 'react';
import { loadSession, type Session } from './api';
import { DocumentList } from './pages/DocumentList';
import { EditorPage } from './pages/EditorPage';
import { LoginPage } from './pages/LoginPage';

/** Minimal hash router: #/ (documents), #/d/<id> (editor). */
function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#/, '') || '/';
}

export const navigate = (path: string) => {
  location.hash = path;
};

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const route = useRoute();

  useEffect(() => {
    const sync = () => setSession(loadSession());
    window.addEventListener('docsync:session', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('docsync:session', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  if (!session) return <LoginPage />;

  const docMatch = route.match(/^\/d\/([0-9a-f-]{36})$/i);
  if (docMatch) return <EditorPage key={docMatch[1]} docId={docMatch[1]} session={session} />;
  return <DocumentList session={session} />;
}
