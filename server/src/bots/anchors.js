// server/src/bots/anchors.js — Bot Arena, Phase 2
//
// The fixed reference points bot-arena-design.md's calibration gauntlet
// and periodic drift-correction anchor the leaderboard against — the
// app's existing five built-in engine difficulty tiers, reused here with
// known, hand-picked fixed ratings rather than invented ones. Point
// estimates come from the same ranges already shown to users on the Lobby
// page's "Play vs. Computer" tier picker (src/pages/Lobby.jsx's TIERS),
// so a bot's Elo roughly lines up with what the UI already tells players
// to expect from each tier. Anchors never update from these games — per
// the design doc, "they're the ruler, not a participant."

const ANCHORS = [
  { anchorId: "anchor-practice", label: "Practice Bot", engineTier: "practice", fixedRating: 500 },
  { anchorId: "anchor-easy", label: "Easy", engineTier: "easy", fixedRating: 900 },
  { anchorId: "anchor-medium", label: "Medium", engineTier: "medium", fixedRating: 1580 },
  { anchorId: "anchor-hard", label: "Hard", engineTier: "hard", fixedRating: 2100 },
  { anchorId: "anchor-expert", label: "Expert", engineTier: "expert", fixedRating: 2850 },
];

function getAnchor(anchorId) {
  return ANCHORS.find((a) => a.anchorId === anchorId) || null;
}

module.exports = { ANCHORS, getAnchor };
