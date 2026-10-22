import React, { createContext, useContext, useState, useCallback } from "react";

const ActiveGameContext = createContext(null);

export function ActiveGameProvider({ children }) {
  const [activeGame, setActiveGameState] = useState(null); // { gameId, isVsComputer } | null

  const setActiveGame = useCallback((game) => setActiveGameState(game), []);
  const clearActiveGame = useCallback(() => setActiveGameState(null), []);

  return (
    <ActiveGameContext.Provider value={{ activeGame, setActiveGame, clearActiveGame }}>
      {children}
    </ActiveGameContext.Provider>
  );
}

export function useActiveGame() {
  return useContext(ActiveGameContext);
}
