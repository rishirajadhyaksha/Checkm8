// server/src/bots/scrub.js — nothing that came out of a bot run is shown to
// anyone or stored until it has been through here. Strips file-system paths,
// token-shaped strings and any known secret; caps length.
const crypto = require("crypto");

// A random value planted in the runner process's environment — a place bot
// code should never be able to reach. If it ever shows up in a bot's output,
// something escaped the sandbox: the language is switched off automatically.
const CANARY = process.env.BOT_CANARY || crypto.randomBytes(16).toString("hex");

const PATTERNS = [
  [/(?:\/(?:home|Users|root|opt|var|tmp|etc|usr|proc|sys|mnt|srv)\b|[A-Za-z]:\\\\)[^\s"'`)\]}]*/g, "[path]"],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[token]"],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g, "[key]"],
  [/\b[a-f0-9]{48,}\b/gi, "[secret]"],
];

function scrubText(text, { max = 500, secrets = [] } = {}) {
  let s = String(text == null ? "" : text);
  for (const secret of [CANARY, ...secrets]) if (secret && secret.length >= 8) s = s.split(secret).join("[secret]");
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function containsCanary(value) {
  try {
    return JSON.stringify(value).includes(CANARY);
  } catch {
    return false;
  }
}

module.exports = { CANARY, scrubText, containsCanary };
