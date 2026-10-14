const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
for (const file of ['qrchecklog.html', 'qr_error_dashboard.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim()) new vm.Script(match[1]);
  }
  const context = { qr1MatchesDetail: () => false };
  vm.createContext(context);
  for (const name of ['PSEUDO_PARTS', 'NON_MISMATCH_NOTES']) {
    vm.runInContext(html.match(new RegExp('const ' + name + ' = new Set\\([\\s\\S]*?\\);'))[0], context);
  }
  const start = html.indexOf('function isPartMismatchLog(');
  const next = html.indexOf('\n  ', start);
  const end = html.indexOf('function ', next);
  vm.runInContext(html.slice(start, end), context);
  const log = {
    result: 'NG', partNumber: '71304-78010', extractNote: 'internal_kanban_fields',
    qr1: 'CUSTOMER DIFFERENT PART', qr2: "shanai A338 71304-78010 0090 00016 7130478010' C"
  };
  assert.equal(context.isPartMismatchLog(log), true, file);
  for (const patch of [
    { result: 'OK' }, { result: 'DUP' }, { isDuplicate: true },
    { orderDetailNote: '数量超過: 71304-78010 5/4' },
    { orderDetailErrorCode: 'quantity_exceeded' },
    { orderDetailNote: '注文明細外: 71304-78010' },
    { extractNote: 'kanban_type_error_step2:94/1-58', partNumber: 'KANBAN_TYPE_ERROR' },
    { extractNote: 'internal_part_not_found', partNumber: 'KANBAN_FORMAT_ERROR' },
    { qr2: '' }, { qr2: '+' }, { partNumber: '' }
  ]) assert.equal(context.isPartMismatchLog({ ...log, ...patch }), false, file + JSON.stringify(patch));
  assert.equal(context.isPartMismatchLog({ ...log, extractNote: 'order_detail_pair_search' }), false);
  context.qr1MatchesDetail = () => true;
  assert.equal(context.isPartMismatchLog({ ...log, extractNote: 'order_detail_pair_search' }), true);
  console.log('PASS: ' + file + ' internal mismatch included; OK, duplicates, overrun and input errors excluded');
}
