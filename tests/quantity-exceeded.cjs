const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '../qrcheck_v2.html'), 'utf8');
function extract(name) {
  const start = html.search(new RegExp('  (?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, name);
  const next = /\n  (?:async )?function /.exec(html.slice(start + 1));
  return html.slice(start, start + 1 + next.index);
}
const elements = new Map();
const c = {
  settings: { scanMode: '1to1' }, database: null, terminalInputMode: 'hid',
  canonicalPart: s => s, normalizeQR: s => s, hashString: s => s,
  isInternalKanbanMode: () => false, orderLinePartValues: l => [l.partNo],
  partsEquivalent: (a, b) => a === b, qrContainsPart: (qr, p) => qr.includes(p),
  qrContainsOrderLineBackNo: () => false, isPassThroughOrderLine: () => false,
  saveOrderDetailSession() {}, renderOrderDetailPanel() {},
  queueOrderDetailSessionWrite() { assert.fail('Overrun must not enqueue progress'); },
  document: { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { style: {}, classList: { remove() {}, contains() { return false; } } });
    return elements.get(id);
  } },
  shortQrTimer: null, okAutoTimer: null, acknowledgementVibrationTimer: null,
  acknowledgementOpen: false, acknowledgementAction: null, isOKPending: true,
  pauseScanInputFocus() {}, updateNGLockVibrationButton() {}, escapeHtml: s => s,
  setNGLocked(value) { assert.equal(value, false); c.locked = value; },
  playSound(type) { c.sounds.push(type); }, startAcknowledgementVibration() {},
  clearScannerBuffer() {}, updateScanUI() {}, dismissKeyboardThenRefocusScanInput() {},
  navigator: {}, sounds: [],
  startScanning(boot) {
    assert.equal(boot, true);
    c.value1 = ''; c.value2 = ''; c.currentStep = 1;
  }
};
vm.createContext(c);
for (const name of ['checkOrderDetailMatch', 'showResult', 'showOrderQuantityExceeded',
  'showAcknowledgementError', 'acknowledgeTransientError']) vm.runInContext(extract(name), c);

(async () => {
  for (const scanMode of ['1to1', '1toN']) {
    c.settings.scanMode = scanMode;
    c.orderDetailSession = { lines: [{ partNo: 'TEST-001', scanned: 4, requiredBoxes: 4 }], scannedIds: {} };
    const before = JSON.stringify(c.orderDetailSession);
    const result = await c.checkOrderDetailMatch('TEST-001', 'CUSTOMER', 'INTERNAL');
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'quantity_exceeded');
    assert.equal(result.note, '数量超過: TEST-001 5/4');
    assert.equal(JSON.stringify(c.orderDetailSession), before);
    const outside = await c.checkOrderDetailMatch('OTHER', 'CUSTOMER', 'INTERNAL');
    assert.equal(outside.errorCode, undefined);

    c.value1 = 'CUSTOMER'; c.value2 = 'INTERNAL'; c.currentStep = 2; c.sounds = [];
    c.showResult(false, false, null, 'TEST-001', {
      orderDetailErrorCode: result.errorCode, orderDetailNote: result.note
    });
    assert.equal(c.acknowledgementOpen, true);
    assert.equal(c.locked, false);
    assert.deepEqual(c.sounds, ['ng']);
    assert.equal(elements.get('adminArea').style.display, 'none');
    assert.equal(elements.get('ackErrorBtn').style.display, 'block');
    c.acknowledgeTransientError();
    assert.equal(c.acknowledgementOpen, false);
    assert.equal(c.value2, '');
    assert.equal(c.currentStep, scanMode === '1toN' ? 2 : 1);
    assert.equal(c.value1, scanMode === '1toN' ? 'CUSTOMER' : '');
    assert.deepEqual(c.sounds, ['ng']);
    assert.equal(JSON.stringify(c.orderDetailSession), before);
  }
  console.log('PASS: overrun rejected without increment; one alert; worker acknowledgement; both scan modes');
})().catch(error => { console.error(error); process.exitCode = 1; });
