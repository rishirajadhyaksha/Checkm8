// frontend/src/pages/BotEditor.jsx — Bot Lab route. The IDE itself lives in
// src/bots/lab/* (LabLayout, EditorPane, ConsolePane, DocsPane, BotsDrawer,
// TestBoard, useLabState). History: Phase 0 sandbox harness -> Phase 1 save/
// publish -> Phase 2 calibration -> Round 2 IDE with a library reference and
// four languages. See the project's bot-arena docs for the full story.
import React from "react";
import LabLayout from "../bots/lab/LabLayout";

export default function BotEditor() {
  return <LabLayout />;
}
