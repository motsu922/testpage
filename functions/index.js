const crypto = require('crypto');
const { onValueCreated } = require('firebase-functions/v2/database');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();

const firestore = getFirestore();
const DATABASE_INSTANCE = 'miyamaunitec-fb87a-default-rtdb';
const AUTO_ORDER_ADMIN_PASSWORD = defineSecret('AUTO_ORDER_ADMIN_PASSWORD');

function canonicalPart(value) {
  return String(value || '').normalize('NFKC').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function instructionId(log, partKey) {
  const source = [log.companyId || '', partKey, log.qr1 || '', log.qr2 || ''].join('|');
  return `ao_${crypto.createHash('sha256').update(source).digest('hex').slice(0, 28)}`;
}

function isValidAdminPassword(request) {
  const supplied = String(request.get('x-auto-order-admin-password') || '');
  const expected = String(AUTO_ORDER_ADMIN_PASSWORD.value() || '').trim();
  if (!supplied || !expected || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function applyCors(request, response) {
  // This endpoint uses an explicit admin-password header and no browser cookies.
  // Allowing any origin prevents local PC/browser origin differences from blocking
  // the CORS preflight before the authenticated request reaches this function.
  response.set('Access-Control-Allow-Origin', '*');
  response.set('Access-Control-Allow-Headers', 'Content-Type, X-Auto-Order-Admin-Password');
  response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

async function readAutoOrderRules() {
  const snapshot = await firestore.collection('auto_order_rules').get();
  return Object.fromEntries(snapshot.docs.map((item) => [item.id, item.data()]));
}

// Management and polling are authenticated at the Function boundary, not by browser database permissions.
exports.manageAutoOrder = onRequest({
  region: 'asia-southeast1',
  secrets: [AUTO_ORDER_ADMIN_PASSWORD]
}, async (request, response) => {
  applyCors(request, response);
  if (request.method === 'OPTIONS') return response.status(204).send('');
  if (!isValidAdminPassword(request)) return response.status(401).json({ error: '管理者認証に失敗しました' });

  const action = String(request.query.action || request.body?.action || '');
  if (request.method === 'GET' && action === 'rules') {
    return response.json({ rules: await readAutoOrderRules() });
  }
  if (request.method === 'POST' && action === 'rules') {
    const parts = Array.isArray(request.body?.parts) ? request.body.parts : [];
    const next = {};
    parts.slice(0, 200).forEach((partNumber) => {
      const partKey = canonicalPart(partNumber);
      if (partKey) next[partKey] = { partNumber: String(partNumber).toUpperCase(), enabled: true, updatedAt: FieldValue.serverTimestamp() };
    });
    const batch = firestore.batch();
    const existing = await firestore.collection('auto_order_rules').get();
    existing.docs.forEach((item) => { if (!next[item.id]) batch.delete(item.ref); });
    Object.entries(next).forEach(([partKey, rule]) => batch.set(firestore.doc(`auto_order_rules/${partKey}`), rule));
    await batch.commit();
    return response.json({ rules: await readAutoOrderRules() });
  }
  if (request.method === 'GET' && action === 'instructions') {
    const status = request.query.status === 'needs_review' ? 'needs_review' : 'pending';
    const snapshot = await firestore.collection('auto_order_instructions').where('status', '==', status).limit(100).get();
    return response.json({ instructions: snapshot.docs.map((item) => ({ instructionId: item.id, ...item.data() })) });
  }
  if (request.method === 'POST' && action === 'status') {
    const instructionId = String(request.body?.instructionId || '');
    const status = String(request.body?.status || '');
    if (!instructionId || !['pending', 'imported', 'duplicate', 'needs_review', 'error'].includes(status)) {
      return response.status(400).json({ error: '更新内容が不正です' });
    }
    await firestore.doc(`auto_order_instructions/${instructionId}`).update({
      status,
      error: String(request.body?.error || ''),
      importedPartNumber: String(request.body?.importedPartNumber || ''),
      importedAt: FieldValue.serverTimestamp()
    });
    return response.json({ ok: true });
  }
  return response.status(404).json({ error: '操作が不正です' });
});

// Browsers can append QR logs, but only this function may create purchase instructions.
exports.createAutoOrderInstruction = onValueCreated({
  ref: '/qr_match_logs/{companyId}/{logId}',
  instance: DATABASE_INSTANCE,
  region: 'asia-southeast1'
}, async (event) => {
  const log = event.data.val() || {};
  if (log.result !== 'OK' || !log.qr1 || !log.qr2) return;

  const partKey = canonicalPart(log.partNumber);
  if (!partKey) return;

  const rule = await firestore.doc(`auto_order_rules/${partKey}`).get();
  if (!rule.exists || rule.data().enabled === false) return;

  const id = instructionId(log, partKey);
  const ref = firestore.doc(`auto_order_instructions/${id}`);
  await firestore.runTransaction(async (transaction) => {
    if ((await transaction.get(ref)).exists) return;
    transaction.create(ref, {
      status: 'pending',
      partKey,
      partNumber: log.partNumber || rule.data().partNumber || '',
      companyId: log.companyId || event.params.companyId,
      companyName: log.companyName || '',
      workerName: log.workerName || log.operatorName || '',
      qr1Raw: log.qr1_raw || log.qr1 || '',
      qr2Raw: log.qr2_raw || log.qr2 || '',
      sourceLogId: log.logId || event.params.logId,
      scannedAt: log.timestamp || new Date().toISOString(),
      createdAt: FieldValue.serverTimestamp()
    });
  });
  logger.info('Created auto-order instruction', { id, partKey });
});
