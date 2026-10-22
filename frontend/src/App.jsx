import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import { ActiveGameProvider } from "./ActiveGameContext";
import AppShell from "./components/AppShell";
import { ConfirmProvider } from "./components/ConfirmDialog";
import Landing from "./pages/Landing";
import Lobby from "./pages/Lobby";
import GameRoom from "./pages/GameRoom";
import History from "./pages/History";
import BotEditor from "./pages/BotEditor";
import BotArena from "./pages/BotArena";
import Leaderboard from "./pages/Leaderboard";
import BotDetail from "./pages/BotDetail";

function Protected({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <SplashLoading />;
  if (!user) return <Navigate to="/" replace />;
  return children;
}

function SplashLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <span className="text-3xl text-brass-500 animate-pulse">♞</span>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ConfirmProvider>
      <ActiveGameProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route
              path="/lobby"
              element={
                <Protected>
                  <Lobby />
                </Protected>
              }
            />
            <Route
              path="/game/:gameId"
              element={
                <Protected>
                  <GameRoom />
                </Protected>
              }
            />
            <Route
              path="/history"
              element={
                <Protected>
                  <History />
                </Protected>
              }
            />
            <Route
              path="/bots/lab"
              element={
                <Protected>
                  <BotEditor />
                </Protected>
              }
            />
            <Route
              path="/bots/arena"
              element={
                <Protected>
                  <BotArena />
                </Protected>
              }
            />
            <Route
              path="/leaderboard"
              element={
                <Protected>
                  <Leaderboard />
                </Protected>
              }
            />
            <Route
              path="/bots/:botId"
              element={
                <Protected>
                  <BotDetail />
                </Protected>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </ActiveGameProvider>
      </ConfirmProvider>
    </AuthProvider>
  );
}
