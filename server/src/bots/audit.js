// server/src/bots/audit.js — append-only audit trail for bot execution
// events (language switched off, canary trip, jail status). Never contains
// bot source. Kept in memory (last 200) and echoed to the process log.
const ring = [];
function record(event, details = {}) {
  const entry = { at: new Date().toISOString(), event, ...details };
  ring.push(entry);
  if (ring.length > 200) ring.shift();
  console.warn(`[bots/audit] ${JSON.stringify(entry)}`);
  return entry;
}
const recent = (n = 50) => ring.slice(-n);
module.exports = { record, recent };
