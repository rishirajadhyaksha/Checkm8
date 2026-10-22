import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "./api";
import { reconnectSocket, disconnectSocket } from "./socket";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("checkm8_token");
    if (!token) {
      setReady(true);
      return;
    }
    api
      .me()
      .then((u) => {
        setUser(u);
        reconnectSocket();
      })
      .catch(() => {
        localStorage.removeItem("checkm8_token");
      })
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (username, password) => {
    const { token, user } = await api.login(username, password);
    localStorage.setItem("checkm8_token", token);
    setUser(user);
    reconnectSocket();
  }, []);

  const signup = useCallback(async (username, password, email) => {
    const { token, user } = await api.signup(username, password, email);
    localStorage.setItem("checkm8_token", token);
    setUser(user);
    reconnectSocket();
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("checkm8_token");
    setUser(null);
    disconnectSocket();
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const u = await api.me();
      setUser(u);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, signup, logout, refreshUser }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
