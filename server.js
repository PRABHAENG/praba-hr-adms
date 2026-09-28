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
    console.log('Firebase initialized successfully');
  }
} catch(e) {
  console.log('Firebase error:', e.message);
}

async function savePunch(empId, date, inTime, outTime) {
  if (!db) return;
  const ref = db.collection('attendance').doc(date);
  const doc = await ref.get();
  let records = doc.exists ? (doc.data().records || []) : [];
  const idx = records.findIndex(r => String(r.empId) === String(empId));
  const rec = { empId: String(empId), date, inTime: inTime||'', outTime: outTime||'', source: 'ZKTeco', syncedAt: new Date().toISOString() };
  if (idx >= 0) {
    if (inTime && (!records[idx].inTime || inTime < records[idx].inTime)) records[idx].inTime = inTime;
    if (outTime && (!records[idx].outTime || outTime > records[idx].outTime)) records[idx].outTime = outTime;
  } else {
    records.push(rec);
  }
  await ref.set({ records, updatedAt: new Date().toISOString() });
}

app.get('/iclock/cdata', (req, res) => {
  console.log('ZKTeco Heartbeat SN:', req.query.SN);
  res.set('Content-Type', 'text/plain');
  res.send('GET OPTION FROM: ' + req.query.SN + '\nStamp=9999\nOPERLOG=Transaction\nErrorDelay=30\nDelay=10\nTransTimes=00:00;14:05\nTransInterval=1\nTransFlag=1111000000\nRealtime=1\nEncrypt=None\n');
});

app.post('/iclock/cdata', async (req, res) => {
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  console.log('ZKTeco Data Push:', body.substring(0, 200));
  const lines = body.split('\n').filter(l => l.trim());
  const punchMap = {};
  for (const line of lines) {
    const parts = line.trim().split(/\t+
