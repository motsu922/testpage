const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'andon-monitor.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'firebase-messaging-sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'andon-monitor.webmanifest'), 'utf8'));

assert.match(html, /id="btnPushRegister"/);
assert.match(html, /Notification\.requestPermission\(\)/);
assert.match(html, /navigator\.serviceWorker\.register\('\.\/firebase-messaging-sw\.js'/);
assert.match(html, /getToken\(messagingInstance/);
assert.match(html, /collection\(db, 'fcm_tokens'\)/);
assert.match(html, /rel="manifest" href="\.\/andon-monitor\.webmanifest"/);
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, './andon-monitor.html');
assert.match(worker, /onBackgroundMessage/);
assert.match(worker, /notificationclick/);
assert.doesNotMatch(worker, /icon:\s*['"]\/icon\.png/);

console.log('PASS: Andon push registration, PWA manifest, and background notification worker');
