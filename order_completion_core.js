(function(root) {
  'use strict';
  const values = value => Array.isArray(value) ? value : Object.values(value || {});
  function documents(session, sessionId) {
    const lines = values(session.lines);
    const allComplete = lines.length > 0 && lines.every(line =>
      Number.isFinite(Number(line.requiredBoxes)) && Number(line.requiredBoxes) > 0 &&
      Number.isFinite(Number(line.scanned)) && Number(line.scanned) >= Number(line.requiredBoxes));
    const excluded = lines.some(line => line.excluded);
    const validCounts = lines.length > 0 && lines.every(line =>
      Number.isFinite(Number(line.requiredBoxes)) && Number(line.requiredBoxes) > 0 &&
      Number.isFinite(Number(line.scanned)) && Number(line.scanned) >= 0);
    let details = values(session.details);
    // A single saved QR cannot stand in for missing QR data in a combined session.
    if (!details.length && Object.keys(session.sourceHashes || {}).length <= 1) {
      details = [{ orderQr: session.orderQr, meta: session.meta, lines }];
    }
    if (!details.length) details = [{}];
    return details.map((detail, index) => {
      const qr = typeof detail.orderQr === 'string' ? detail.orderQr : '';
      const meta = detail.meta || (details.length === 1 ? session.meta : {}) || {};
      const reason = excluded || values(detail.lines).some(l => l.excluded) ? '照合除外あり' :
        !allComplete ? '全行の照合完了を確認できません' :
        !Number.isFinite(Date.parse(session.completedAt)) ? '完了日時なし' : !qr ? '明細QRデータなし' : '';
      const customerId = String(meta.customerId || meta.customerCode || '');
      return {
        sessionId, index, qr, meta, customerId, reason, completedAt: session.completedAt || '',
        incomplete: validCounts && !allComplete && !excluded && !values(detail.lines).some(l => l.excluded) && !!qr,
        progress: `${lines.reduce((n,l) => n + (Number(l.scanned) || 0),0)}/${lines.reduce((n,l) => n + (Number(l.requiredBoxes) || 0),0)}`,
        updatedAt: session.updatedAt || '',
        lines: values(detail.lines), groupSize: details.length,
        orderNo: String(meta.orderNo || ''),
        deliveryDate: String(meta.deliveryDate || meta.instructionDate || ''),
        bin: String(meta.deliveryBin || meta.bin || ''),
        // Saved orderQr is normalized by v2. Never label it as an original QR.
        sourceWarning: '保存データから再生成したQRです。原本との完全一致は未確認です。'
      };
    });
  }
  function transition(current, command, context) {
    if (command !== 'posted' || !context.document) return undefined;
    const prior = current || {};
    if (prior.status === 'posted') return undefined;
    return { ...prior, ...context.document, status:'posted', postedAt:context.at, updatedAt:context.at, method:'qr_click' };
  }
  const core = { documents, transition };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else root.CompletionCore = core;
})(typeof window === 'undefined' ? globalThis : window);
