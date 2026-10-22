// server/src/bots/killSwitch.js — Bot Arena, Phase 0
//
// A site-wide switch to stop ALL bot code execution immediately, without a
// redeploy. If a sandbox-escape or crash-class bug ever turns up (see the
// note in runnerPool.js about the stack-overflow abort we found while
// building this), this is what lets it be shut off in seconds rather than
// waiting on a deploy. Defaults to enabled; can be disabled via env var at
// startup, or toggled at runtime (e.g. from a future admin route).

let enabled = process.env.BOT_EXECUTION_ENABLED !== "false";
let disabledReason = null;

function isEnabled() {
  return enabled;
}

function disable(reason = "manually disabled") {
  enabled = false;
  disabledReason = reason;
  console.warn(`[bots/killSwitch] Bot execution DISABLED: ${reason}`);
}

function enableSwitch() {
  enabled = true;
  disabledReason = null;
  console.warn("[bots/killSwitch] Bot execution re-enabled.");
}

function getStatus() {
  return { enabled, disabledReason };
}

// Per-language switches. BOT_LANGUAGES_DISABLED="python,lua" disables
// languages at startup; disableLanguage()/enableLanguage() toggle at runtime
// (see the admin route) so one runtime can be turned off in seconds without
// a deploy if an escape is ever reported.
const disabledLanguages = new Map(
  String(process.env.BOT_LANGUAGES_DISABLED || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((l) => [l, "disabled by configuration"])
);

function isLanguageEnabled(language) {
  return enabled && !disabledLanguages.has(language);
}
function disableLanguage(language, reason = "manually disabled") {
  disabledLanguages.set(language, reason);
  console.warn(`[bots/killSwitch] Language ${language} DISABLED: ${reason}`);
}
function enableLanguage(language) {
  disabledLanguages.delete(language);
  console.warn(`[bots/killSwitch] Language ${language} re-enabled.`);
}
function getLanguageStatus() {
  return Object.fromEntries([...disabledLanguages.entries()]);
}

module.exports = { isEnabled, disable, enable: enableSwitch, getStatus, isLanguageEnabled, disableLanguage, enableLanguage, getLanguageStatus };
