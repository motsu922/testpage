const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '../qrcheck_v2.html'), 'utf8');
const c = {
  hashString: s => require('node:crypto').createHash('sha256').update(s).digest('hex'),
  canonicalPart: s => s.replace(/-/g, ''), partsEquivalent: (a, b) => a === b,
  isPassThroughOrderLine: () => false
};
vm.createContext(c);
for (const name of ['orderDetailIdentityQR', 'buildOrderDetailContentHash', 'normalizeOrderDetailSessionData',
  'mergeOrderLineInto', 'mergeParsedOrderDetail', 'orderRequiredBoxesFrom', 'orderScannedBoxesFrom', 'mergeQueuedOrderDetailSession']) {
  const start = html.indexOf('  function ' + name + '(');
  assert.ok(start >= 0);
  const end = /\n  (?:async )?function /.exec(html.slice(start + 1));
  vm.runInContext(html.slice(start, start + 1 + end.index), c);
}
const make = (qr, orderNo = '') => ({ orderQr: qr, meta: { customerId: 'customer', orderNo },
  lines: [{ partNo: 'PART-001', packQty: 10, totalQty: 40, requiredBoxes: 4, backNo: '' }] });
const a = make('ORDER-A');
const b = make('ORDER-B');
assert.equal(c.buildOrderDetailContentHash(a), c.buildOrderDetailContentHash(b));
let first = c.mergeParsedOrderDetail({ sessionId: 'test' }, a).session;
first.lines[0].scanned = 2;
const appended = c.mergeParsedOrderDetail(structuredClone(first), b);
assert.equal(appended.added, true);
assert.equal(appended.session.lines[0].requiredBoxes, 8);
assert.equal(appended.session.lines[0].totalQty, 80);
assert.equal(appended.session.lines[0].scanned, 2);
for (const qr of [a, b]) {
  const repeat = c.mergeParsedOrderDetail(appended.session, qr);
  assert.equal(repeat.duplicate, true);
  assert.equal(repeat.session.lines[0].requiredBoxes, 8);
}
const synced = c.mergeQueuedOrderDetailSession(first, appended.session);
assert.equal(synced.details.length, 2);
assert.equal(synced.lines[0].requiredBoxes, 8);
assert.equal(c.mergeQueuedOrderDetailSession(synced, appended.session).details.length, 2);
// Existing content-only hashes must not suppress a different QR.
first.detailHashes[c.buildOrderDetailContentHash(b)] = true;
assert.equal(c.mergeParsedOrderDetail(first, b).added, true);
const numbered = make('ISSUE-1', 'PO-1');
const original = c.mergeParsedOrderDetail({}, numbered).session;
assert.equal(c.mergeParsedOrderDetail(original, make('REISSUE-1', 'PO-1')).duplicate, true);
assert.equal(c.mergeParsedOrderDetail(original, make('ORDER-2', 'PO-2')).added, true);
const daily = date => ({ ...a, meta: { detailType: 'aites_simple_detail', readDate: date } });
const dayOne = c.mergeParsedOrderDetail({}, daily('2026-10-27')).session;
assert.equal(c.mergeParsedOrderDetail(dayOne, daily('2026-10-27')).duplicate, true);
assert.equal(c.mergeParsedOrderDetail(dayOne, daily('2026-10-28')).added, true);
console.log('PASS: equal-content distinct orders, repeated QR, legacy hashes, sync, order reissue and Aites date identity');
