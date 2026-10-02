const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '../qrcheck_v2.html'), 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
  if (match[1].trim()) new vm.Script(match[1]);
}
function extract(name) {
  const start = html.search(new RegExp('  (?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, name);
  const next = /\n  (?:async )?function /.exec(html.slice(start + 1));
  assert.ok(next, name);
  return html.slice(start, start + 1 + next.index);
}
const context = {
  kanbanMatchMode: 'internal',
  settings: { extractRules: [{ minLen: 1, maxLen: 200, startPos: 16, charCount: 12, prefix: '' }] },
  findOrderDetailPartInQR: () => null,
  findOrderDetailPartPair: () => null,
  resolveAliases: part => [part]
};
vm.createContext(context);
for (const name of ['isInternalKanbanMode', 'normalizeQR', 'parseInternalKanban', 'pickRule',
  'extractPartNumberFrom', 'extractPartNumberForMatch', 'canonicalPart', 'trimPartAfterSecondHyphen',
  'partVariants', 'partSearchTokens', 'qrContainsPart', 'extractOrderDetailPartForPair']) {
  vm.runInContext(extract(name), context);
}

const cases = [
  ["' A215 71306-X7V22 0006 00150 71306X7V22' TP-331", '71306-X7V22'],
  ["shanai A215 71306-X7V22 0010 00150 71306X7V22' TP331", '71306-X7V22'],
  ["shanai N0018 72611-X1C34 0023 00060 72611X1C34' D", '72611-X1C34'],
  ["shanai HA0006 60 71331-X1B02 0022 00250 71331X1B02' TP331", '71331-X1B02'],
  ["' A177 71331-X1B02 0001 00250 71331X1B02'", '71331-X1B02'],
  ["' 7700 0J49 7FA190-7070 0005 00010 7FA1907070' TP-332", '7FA190-7070']
];
let checks = 0;
function verify(qr, part) {
  const result = context.extractPartNumberForMatch(qr);
  assert.equal(result.part, part, qr);
  assert.equal(context.normalizeQR(qr).slice(result.start0, result.start0 + part.length).toUpperCase(), part);
  assert.equal(context.qrContainsPart(qr, part), true);
  assert.equal(context.qrContainsPart(qr, part.slice(1)), false);
  checks++;
}
for (const [qr, part] of cases) verify(qr, part);
for (const prefix of ['', "' ", '" ', 'shanai ', "' shanai ", "shanai ' ", 'SHANAI ', '\u201cshanai ']) {
  for (const code of ['A215', 'N0018', '0018', 'HA0001', 'HA0006', 'UNKNOWN-LOCATION']) {
    for (const extra of ['', '60 ', '60 99 ', 'OTHER ']) {
      for (const box of ['', 'D', 'C', 'F', 'TP331', 'TP332', 'BOX / OTHER']) {
        verify(prefix + code + ' ' + extra + "71331-X1B02 0022 00250 71331X1B02' " + box, '71331-X1B02');
      }
    }
  }
}
for (const bad of ['BAD QR', '71331-X1B02 22 00250', '71331-X1B02 0022 BAD']) {
  assert.equal(context.extractPartNumberForMatch(bad).part, '');
}
for (const next of [cases[3][0], cases[2][0]]) {
  const joined = cases[3][0] + ' ' + next;
  assert.equal(context.parseInternalKanban(joined).note, 'internal_part_ambiguous');
  assert.equal(context.extractPartNumberForMatch(joined).part, '');
  assert.equal(context.qrContainsPart(joined, '71331-X1B02'), false);
}
assert.equal(context.extractOrderDetailPartForPair(cases[3][0], cases[4][0]).isQROK, true);
assert.equal(context.extractOrderDetailPartForPair(cases[3][0], cases[2][0]).isQROK, false);
assert.equal(context.qrContainsPart(cases[2][0], '72611-X1C34-00'), true);
context.resolveAliases = part => part === 'ALIAS-PART' ? [part, '72611-X1C34'] : [part];
assert.equal(context.qrContainsPart(cases[2][0], 'ALIAS-PART'), true);
context.kanbanMatchMode = 'customer';
// Production failure on 2026-10-02: customer mode without an order detail.
const qr1 = '[)>\x1e06\x1d6V400259565\x1d11V1\x1d20L00\x1d2L400090555 1 \x1d1L1\x1d7V400090555 1 \x1d9K2043\x1d16D20261002\x1d9D1\x1d10K90M00102\x1d20P0J49\x1dP7FA190-7070\x1dQ10\x1d2P0\x1d17K1\x1dZ;00ZE;01Z ;02ZS18 - ;03Z2 ;04Z7195 ;05Z5;06Z0;07Z;08Z\x1e\x04';
const qr2 = cases[5][0];
context.settings.extractRules[0].startPos = 8;
assert.equal(qr2.substring(7, 19).trim(), '0J49 7FA190-');
const recovered = context.extractPartNumberForMatch(qr2);
assert.equal(recovered.part, '7FA190-7070');
assert.equal(recovered.note, 'internal_kanban_fields');
assert.equal(recovered.rule, null);
assert.equal(context.qrContainsPart(qr1, recovered.part), true);
assert.equal(context.qrContainsPart(qr1.replace('P7FA190-7070', 'P7FA190-7071'), recovered.part), false);
context.settings.extractRules[0].startPos = 16;
const customer = '[)>\x1e06\x1dP72611-X1C34-00\x1dQ60';
assert.equal(context.qrContainsPart(customer, context.extractPartNumberForMatch(cases[2][0]).part), true);
context.findOrderDetailPartInQR = () => ({ part: 'DETAIL-HIT', index: 0, hit: 'DETAIL-HIT' });
assert.equal(context.extractPartNumberForMatch(cases[2][0]).note, 'order_detail_search');
context.findOrderDetailPartInQR = () => null;
const legacy = 'UNRECOGNIZED-CUSTOMER-QR-12345';
assert.equal(context.extractPartNumberForMatch(legacy).part, legacy.substring(15, 27));
console.log(`PASS: ${checks} extraction cases; ambiguity, wrong parts, aliases, customer matching and legacy fallback`);
