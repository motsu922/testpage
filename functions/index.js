const crypto = require('crypto');
const { onValueCreated } = require('firebase-functions/v2/database');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();

const firestore = getFirestore();
const DATABASE_INSTANCE = 'miyamaunitec-fb87a-default-rtdb';

function canonicalPart(value) {
  return String(value || '').normalize('NFKC').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function instructionId(log, partKey) {
  const source = [log.companyId || '', partKey, log.qr1 || '', log.qr2 || ''].join('|');
  return `ao_${crypto.createHash('sha256').update(source).digest('hex').slice(0, 28)}`;
}

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
