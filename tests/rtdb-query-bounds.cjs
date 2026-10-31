const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const files = {};
for (const file of ['qrdash.html', 'qr_error_dashboard.html']) {
  files[file] = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  for (const match of files[file].matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim()) new vm.Script(match[1]);
  }
}
function extract(html, name) {
  const start = html.indexOf('function ' + name + '(');
  const next = html.indexOf('\n  function ', start + 1);
  return html.slice(start, next);
}
const calls = [], handlers = [];
const c = { sessionsRef: null, namesRef: null, store: { set() {} }, COMPANY_KEY: 'company',
  companyId: 'test', subscribedDay: '', customerNames: {}, sessions: [], render() {}, setConn() {}, console,
  database: { ref(p) {
    const call = { path: p }; calls.push(call);
    const ref = { off() {}, orderByChild(v) { call.order = v; return ref; },
      startAt(v) { call.start = v; return ref; }, endAt(v) { call.end = v; return ref; },
      on(event, fn) { handlers.push({ path: p, fn }); } };
    return ref;
  } }
};
vm.createContext(c);
vm.runInContext(extract(files['qrdash.html'], 'subscribe'), c);
c.subscribe();
const query = calls.find(call => call.order);
assert.equal(query.order, 'updatedAt');
assert.equal(Date.parse(query.end) - Date.parse(query.start), 86400000 - 1);
assert.ok(query.start.endsWith('15:00:00.000Z'));
const stale = handlers.find(h => h.path.includes('order_detail_sessions'));
c.subscribe();
stale.fn({ val: () => ({ old: { sessionId: 'old' } }) });
assert.equal(c.sessions.length, 0);
assert.ok(files['qrdash.html'].includes('if (subscribedDay !== day) subscribe();'));
const dashboard = files['qr_error_dashboard.html'];
const queryCode = dashboard.slice(dashboard.indexOf('const ref = database.ref(`qr_match_logs/'), dashboard.indexOf("ref.on('value'", dashboard.indexOf('const ref = database.ref(`qr_match_logs/')));
const bounds = {};
const ref = { orderByChild() { return ref; }, startAt(v) { bounds.start = v; return ref; }, endAt(v) { bounds.end = v; return ref; } };
vm.runInNewContext(queryCode, { database: { ref: () => ref }, company: {id: 'test'}, selectedDateKey: '2026-10-01', queryStartIso: () => '2026-09-30T15:00:00.000Z' });
assert.equal(bounds.end, '2026-10-01T14:59:59.999Z');
assert.equal(Date.parse(bounds.end) - Date.parse(bounds.start), 86400000 - 1);
console.log('PASS: JST day bounds, stale subscription guard, rollover, dashboard historical date, script syntax');
