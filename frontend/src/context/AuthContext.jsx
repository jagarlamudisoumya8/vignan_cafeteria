import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken } from '../services/api';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('vignan_user')); } catch { return null; } });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api('/auth/profile').then(data => { setUser(data.user); localStorage.setItem('vignan_user', JSON.stringify(data.user)); }).catch(() => { localStorage.removeItem('vignan_token'); localStorage.removeItem('vignan_user'); setUser(null); }).finally(() => setReady(true));
  }, []);
  const authenticate = data => { localStorage.setItem('vignan_token', data.token); localStorage.setItem('vignan_user', JSON.stringify(data.user)); setUser(data.user); };
  const logout = async () => { try { await api('/auth/logout', { method: 'POST' }); } catch {} localStorage.removeItem('vignan_token'); localStorage.removeItem('vignan_user'); setUser(null); };
  return <AuthContext.Provider value={{ user, ready, authenticate, logout }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
