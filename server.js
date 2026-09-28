const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors({ origin: '*' }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.text({ type: '*/*' }));
let db = null;
try {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (sa.project_id) {
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    db = admin.firestore();
    console.log('Firebase connected');
  }
} catch(e) { console.log('Firebase error:', e.message); }
const memStore = {};
async function savePunch(empId, date, inTime, outTime) {
  const rec = { empId: String(empId), date: date, inTime: inTime || '', outTime: outTime || '', source: 'ZKTeco', syncedAt: new Date().toISOString() };
  if (db) {
    try {
      const ref = db.collection('attendance').doc(date);
      const doc = await ref.get();
      let records = doc.exists ? (doc.data().records || []) : [];
      const idx = records.findIndex(function(r) { return String(r.empId) === String(empId); });
      if (idx >= 0) {
        if (inTime && (!records[idx].inTime || inTime < records[idx].inTime)) records[idx].inTime = inTime;
        if (outTime && (!records[idx].outTime || outTime > records[idx].outTime)) records[idx].outTime = outTime;
      } else { records.push(rec); }
      await ref.set({ records: records, updatedAt: new Date().toISOString() });
    } catch(e) { console.log('Save error:', e.message); }
  } else {
    if (!memStore[date]) memStore[date] = [];
    const idx = memStore[date].findIndex(function(r) { return String(r.empId) === String(empId); });
    if (idx >= 0) memStore[date][idx] = rec; else memStore[date].push(rec);
  }
}
app.get('/iclock/cdata', function(req, res) {
  console.log('ZKTeco Heartbeat SN:' + req.query.SN);
  res.set('Content-Type', 'text/plain');
  res.send('GET OPTION FROM: ' + req.query.SN + '\nStamp=9999\nOPERLOG=Transaction\nErrorDelay=30\nDelay=10\nTransTimes=00:00;14:05\nTransInterval=1\nTransFlag=1111000000\nRealtime=1\nEncrypt=None\n');
});
app.post('/iclock/cdata', async function(req, res) {
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  console.log('ZKTeco Push:' + body.substring(0, 100));
  const lines = body.split('\n');
  const punchMap = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const empId = parts[0].trim();
    const m = (parts[1] || '').match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
    if (!m || !empId) continue;
    const key = empId + '|' + m[1];
    if (!punchMap[key]) punchMap[key] = { empId: empId, date: m[1], times: [] };
    punchMap[key].times.push(m[2]);
  }
  let saved = 0;
  const keys = Object.keys(punchMap);
  for (let i = 0; i < keys.length; i++) {
    const d = punchMap[keys[i]];
    d.times.sort();
    await savePunch(d.empId, d.date, d.times[0], d.times.length > 1 ? d.times[d.times.length-1] : '');
    saved++;
  }
  res.set('Content-Type', 'text/plain');
  res.send('OK: ' + saved);
});
app.get('/iclock/getrequest', function(req, res) { res.set('Content-Type','text/plain'); res.send('OK'); });
app.post('/iclock/devicecmd', function(req, res) { res.set('Content-Type','text/plain'); res.send('OK'); });
app.get('/api/attendance', async function(req, res) {
  const date = req.query.date;
  if (!date) return res.json({ error: 'date required' });
  if (!db) return res.json({ date: date, records: memStore[date] || [] });
  try {
    const doc = await db.collection('attendance').doc(date).get();
    res.json({ date: date, records: doc.exists ? (doc.data().records || []) : [] });
  } catch(e) { res.json({ date: date, records: [] }); }
});
app.get('/', function(req, res) {
  res.json({ status: 'running', service: 'Praba HR ADMS Server', firebase: db ? 'connected' : 'disconnected' });
});
app.listen(PORT, function() { console.log('Server running on port ' + PORT); });
