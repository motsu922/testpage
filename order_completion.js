'use strict';
const completionConfig = {
  apiKey:'AIzaSyAOMRoojKv9Hnh3OjVGwYV_k1LBTGOKepY', authDomain:'miyamaunitec-fb87a.firebaseapp.com',
  databaseURL:'https://miyamaunitec-fb87a-default-rtdb.asia-southeast1.firebasedatabase.app', projectId:'miyamaunitec-fb87a'
};
const $ = id => document.getElementById(id);
const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db, online = false, generation = 0, query = null, items = [], master = {}, loadedCompany = '';
let receiptRefs = [];
let displayedKey = '', clickBlockedUntil = 0;
let replayKey = '';
const receipts = new Map(), known = new Set(), saving = new Set();
function message(text = '') { $('message').textContent = text; }
function ymd(value) { const s = String(value || ''); return /^\d{8}$/.test(s) ? `${s.slice(0,4)}/${s.slice(4,6)}/${s.slice(6)}` : s || '-'; }
function destination(item) {
  const m = item.meta;
  const name = m.destinationName || m.deliveryName || master[item.customerId] || m.customerName || item.customerId;
  return [name, m.destinationCode, m.receivingCode].filter(Boolean).join(' / ') || '未設定';
}
function pending(item) { return known.has(item.key) && receipts.get(item.key)?.status !== 'posted'; }
function postedItems() { return items.filter(item => known.has(item.key) && receipts.get(item.key)?.status === 'posted'); }
function incompleteItems() { return $('showIncomplete').checked ? items.filter(item => item.incomplete && pending(item)) : []; }
function renderIncomplete() {
  const list = incompleteItems();
  $('incompleteSection').hidden = !$('showIncomplete').checked;
  $('incompleteTitle').textContent = `未完了 ${list.length}枚`;
  $('incompleteRows').innerHTML = list.length ? list.map(item => `<tr><td>${html(destination(item))}</td><td>${html(ymd(item.deliveryDate))} / ${html(item.bin || '-')}便</td><td>${html(item.progress)}</td><td><button class="incomplete-qr" data-key="${item.key}" ${!online || saving.size ? 'disabled' : ''}>QR表示</button></td></tr>`).join('') : '<tr><td colspan="4">対象の未完了明細はありません</td></tr>';
  $('incompleteRows').querySelectorAll('button').forEach(button => button.addEventListener('click',() => {
    if (saving.size || !online) return;
    replayKey = button.dataset.key; render(); $('replayBar').scrollIntoView({block:'nearest'});
  }));
}
function renderHistory() {
  const list = postedItems().sort((a,b) => Number(receipts.get(b.key).postedAt || 0)-Number(receipts.get(a.key).postedAt || 0));
  $('historyTitle').textContent = `処理済み ${list.length}枚`;
  $('historyRows').innerHTML = list.length ? list.map(item => {
    const time = receipts.get(item.key).postedAt;
    const date = time ? new Date(time) : null;
    const stamp = date && Number.isFinite(date.getTime()) ? date.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false}) : '-';
    return `<tr><td>${html(destination(item))}</td><td>${html(ymd(item.deliveryDate))} / ${html(item.bin || '-')}便</td><td>${html(stamp)}</td><td><button class="history-qr" data-key="${item.key}" ${!online || saving.size || !item.qr || item.reason ? 'disabled' : ''}>QR再表示</button></td></tr>`;
  }).join('') : '<tr><td colspan="4">処理済みの明細はありません</td></tr>';
  $('historyRows').querySelectorAll('button').forEach(button => button.addEventListener('click',() => {
    if (saving.size || !online) return;
    replayKey = button.dataset.key; render(); $('replayBar').scrollIntoView({block:'nearest'});
  }));
}
function render() {
  const list = items.filter(item => !item.reason && pending(item));
  // Wait for every receipt before selecting the next QR, to keep the order stable.
  const loading = items.some(item => !known.has(item.key));
  if (!loading && !list.some(item => item.key === displayedKey)) displayedKey = list[0]?.key || '';
  if (replayKey && ![...postedItems(),...incompleteItems()].some(item => item.key === replayKey)) replayKey = '';
  const previewLabel = incompleteItems().some(item => item.key === replayKey) ? '未完了QR・確認用（完納処理対象外）' : '処理済みQR・再表示';
  $('replayLabel').textContent = previewLabel;
  const shown = loading ? [] : replayKey ? items.filter(item => item.key === replayKey) : list.filter(item => item.key === displayedKey);
  $('replayBar').hidden = !replayKey;
  const visible = new Set(shown.map(item => item.key));
  $('grid').querySelectorAll('[data-key]').forEach(node => { if (!visible.has(node.dataset.key)) node.remove(); });
  $('grid').querySelector('.empty')?.remove();
  for (const item of shown) {
    let node = $('grid').querySelector(`[data-key="${item.key}"]`);
    if (node && node.dataset.mode !== (replayKey ? 'replay' : 'pending')) { node.remove(); node = null; }
    if (!node) {
      node = document.createElement('article'); node.className = 'qr-item'; node.dataset.key = item.key;
      node.dataset.mode = replayKey ? 'replay' : 'pending';
      node.innerHTML = `<button class="qr-button ${replayKey ? 'replay' : ''}" aria-label="${html(destination(item))} ${html(item.orderNo)} ${replayKey ? previewLabel : 'を処理済みにする'}" title="${replayKey ? previewLabel : '処理済みにする'}"><div class="qr-code"></div></button>
        <div class="meta"><strong>納入先 ${html(destination(item))}</strong><br>納入日 ${html(ymd(item.deliveryDate))}　便 ${html(item.bin || '-')}</div>`;
      node.querySelector('button').addEventListener('click',event => { if (event.detail > 1 || replayKey) return; post(item.key); });
      $('grid').append(node);
    }
    const button = node.querySelector('button'), qr = node.querySelector('.qr-code');
    button.disabled = !online || !!saving.size || Date.now() < clickBlockedUntil;
    if (!online) { qr.replaceChildren(); delete node.dataset.drawn; }
    else if (!node.dataset.drawn) {
      try {
        if (typeof QRCode === 'undefined') throw Error('QR描画ライブラリを読み込めません。再読み込みしてください。');
        qr.replaceChildren();
        new QRCode(qr,{text:item.qr,width:640,height:640,correctLevel:QRCode.CorrectLevel.M});
        node.dataset.drawn = 'true';
      } catch (error) { qr.textContent = 'QRを表示できません'; button.disabled = true; message(error.message); }
    }
  }
  const reviewing = items.filter(item => item.reason && pending(item) && !incompleteItems().includes(item));
  $('count').textContent = `未処理 ${list.length}枚`;
  $('review').hidden = !reviewing.length;
  $('reviewCount').textContent = `要確認 ${reviewing.length}枚`;
  $('reviewList').innerHTML = reviewing.map(item => `<li>${html(destination(item))} / ${html(item.orderNo || item.sessionId)}：${html(item.reason)}</li>`).join('');
  if (!shown.length) {
    $('grid').innerHTML = `<div class="empty">${loading ? '処理状況を確認中…' : '未処理のQRはありません'}</div>`;
  }
  renderHistory();
  renderIncomplete();
}
async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes),byte => byte.toString(16).padStart(2,'0')).join('');
}
function receiptRef(key) { return db.ref(`qr_match_companies/order_completion/${loadedCompany}/${key}`); }
function detachReceipts() { receiptRefs.forEach(ref => ref.off()); receiptRefs = []; }
async function load() {
  if (saving.size) return;
  const company = $('company').value, from = $('dateFrom').value, to = $('dateTo').value;
  if (!company || !from || !to || from > to) { message('会社と正しい期間を指定してください。'); return; }
  const serial = ++generation;
  const includeIncomplete = $('showIncomplete').checked;
  $('dateLabel').textContent = includeIncomplete ? '明細更新日・開始' : '照合完了日・開始';
  query?.off(); detachReceipts(); items = []; receipts.clear(); known.clear(); loadedCompany = company; displayedKey = ''; replayKey = '';
  render(); message('明細を取得しています…');
  try {
    const names = await db.ref(`qr_match_companies/customer_name_master/${company}`).once('value');
    if (serial !== generation) return;
    master = names.val() || {};
    query = db.ref(`qr_match_companies/order_detail_sessions/${company}`).orderByChild(includeIncomplete ? 'updatedAt' : 'completedAt')
      .startAt(new Date(from+'T00:00:00+09:00').toISOString()).endAt(new Date(to+'T23:59:59.999+09:00').toISOString());
    let revision = 0;
    query.on('value',async snap => {
      const update = ++revision;
      try {
        const docs = Object.entries(snap.val() || {}).flatMap(([key,session]) => CompletionCore.documents(session,key));
        const keyed = await Promise.all(docs.map(async item => ({...item,key:await digest(item.qr || `${item.sessionId}/${item.index}`)})));
        if (serial !== generation || update !== revision) return;
        const unique = new Map();
        keyed.sort((a,b) => Date.parse(b.completedAt)-Date.parse(a.completedAt)).forEach(item => { if (!unique.has(item.key)) unique.set(item.key,item); });
        items = [...unique.values()]; detachReceipts(); receipts.clear(); known.clear(); render(); message();
        for (const item of items) {
          const ref = receiptRef(item.key); receiptRefs.push(ref);
          ref.on('value',snapshot => {
            if (serial !== generation || update !== revision) return;
            receipts.set(item.key,snapshot.val()); known.add(item.key); render();
          },error => {
            if (serial !== generation || update !== revision) return;
            known.delete(item.key); receipts.delete(item.key); render();
            message('処理記録を取得できません。権限または接続を確認してください。'+error.message);
          });
        }
      } catch (error) {
        if (serial !== generation || update !== revision) return;
        items = []; detachReceipts(); render(); message('明細を取得できません。'+error.message);
      }
    },error => {
      if (serial !== generation) return;
      items = []; detachReceipts(); render(); message('明細を取得できません。'+error.message);
    });
  } catch (error) { if (serial === generation) message('データを取得できません。'+error.message); }
}
async function post(key) {
  const item = items.find(item => item.key === key);
  if (replayKey || !online || !item || item.reason || !pending(item) || saving.size || key !== displayedKey || Date.now() < clickBlockedUntil) return;
  const company = loadedCompany, serial = generation;
  saving.add(key); $('load').disabled = true; $('company').disabled = true; $('showIncomplete').disabled = true; render();
  try {
    const snap = await db.ref(`qr_match_companies/order_detail_sessions/${company}/${item.sessionId}`).once('value');
    const current = snap.val();
    const source = current && CompletionCore.documents(current,item.sessionId).find(doc => doc.qr === item.qr && !doc.reason);
    if (!source || source.completedAt !== item.completedAt) throw Error('明細が更新されています。「表示」で再取得してください。');
    if (!online || serial !== generation) throw Error('接続が変わりました。処理状況を確認してください。');
    const result = await receiptRef(key).transaction(current => CompletionCore.transition(current,'posted',{
      at:firebase.database.ServerValue.TIMESTAMP,
      document:{sessionId:item.sessionId,orderNo:item.orderNo,customerId:item.customerId,completedAt:item.completedAt,qrKey:key}
    }),undefined,false);
    if (!result.committed && result.snapshot.val()?.status !== 'posted') throw Error('保存結果を確認できません。');
    receipts.set(key,result.snapshot.val()); known.add(key); message();
    clickBlockedUntil = Date.now() + 700;
    setTimeout(render,710);
  } catch (error) { message('処理済みの保存結果を確認できませんでした。QRを再読込せず、処理状況を確認してください。\n'+error.message); }
  finally { saving.delete(key); $('load').disabled = !!saving.size; $('company').disabled = !!saving.size; $('showIncomplete').disabled = !!saving.size; render(); }
}
async function init() {
  const today = new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  $('dateFrom').value = today; $('dateTo').value = today;
  try { const saved = localStorage.getItem('order_completion_qr_size'); if (['180','260','340'].includes(saved)) $('qrSize').value = saved; } catch (_) {}
  const resize = () => {
    document.documentElement.style.setProperty('--qr-size',$('qrSize').value+'px');
    try { localStorage.setItem('order_completion_qr_size',$('qrSize').value); } catch (_) {}
  };
  resize(); $('qrSize').addEventListener('change',resize);
  $('backToPending').addEventListener('click',() => { replayKey = ''; render(); });
  $('load').addEventListener('click',load); $('company').addEventListener('change',load);
  $('showIncomplete').addEventListener('change',load);
  window.addEventListener('beforeunload',event => { if (saving.size) { event.preventDefault(); event.returnValue = ''; } });
  try {
    firebase.initializeApp(completionConfig); db = firebase.database();
    db.ref('.info/connected').on('value',snapshot => {
      online = snapshot.val() === true;
      $('connection').textContent = online ? 'オンライン' : 'オフライン・処理停止';
      $('connection').className = online ? 'online' : ''; render();
    });
    const snap = await db.ref('qr_match_companies/profiles').once('value');
    const companies = Object.entries(snap.val() || {}).map(([key,value]) => ({...value,id:value.id || key}))
      .sort((a,b) => (b.name === 'ミヤマ')-(a.name === 'ミヤマ') || String(a.name).localeCompare(String(b.name),'ja'));
    $('company').innerHTML = companies.map(company => `<option value="${html(company.id)}">${html(company.name)}</option>`).join('');
    $('company').disabled = !companies.length;
    if (companies.length) await load(); else message('会社が登録されていません。');
  } catch (error) { message('接続できません。'+error.message); }
}
init();
