#!/usr/bin/env node
/*
  Sync hourlyWage on timecards to member/org settings.
  Usage:
    node scripts/sync-hourly-wage.cjs --org <ORG_ID> [--month YYYY-MM] [--mode missing|all] [--yes]
  Notes:
    - mode=missing  : update only when hourlyWage is missing/invalid (default)
    - mode=all      : update even when different from resolved wage
    - If --org omitted, prints organization list and exits
*/
const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

function initAdmin() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (privateKey) privateKey = privateKey.replace(/\\n/g, '\n');
  if (!projectId) throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID / FIREBASE_PROJECT_ID not set');
  if (clientEmail && privateKey) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    console.log('[sync-hourly-wage] Initialized with service account');
  } else {
    initializeApp({ projectId });
    console.log('[sync-hourly-wage] Initialized with default credentials');
  }
  return getFirestore();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { month: undefined, org: undefined, mode: 'missing', yes: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--org') out.org = args[++i];
    else if (a === '--month') out.month = args[++i];
    else if (a === '--mode') out.mode = args[++i];
    else if (a === '--yes' || a === '-y') out.yes = true;
  }
  return out;
}

function monthRange(ym) {
  const d = ym ? new Date(ym + '-01T00:00:00') : new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const startKey = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-01`;
  const endKey = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-01`;
  return { startKey, endKey };
}

(async function main(){
  try {
    loadEnvLocal();
    const db = initAdmin();
    const { org, month, mode, yes } = parseArgs();

    if (!org) {
      console.log('No --org provided. Listing organizations:');
      const snap = await db.collection('organizations').get();
      if (snap.empty) {
        console.log('(no organizations found)');
        process.exit(0);
      }
      snap.forEach(d => {
        const data = d.data() || {};
        console.log(`- ${d.id}  name=${data.name || '(no name)'}  defaultHourlyWage=${data.defaultHourlyWage ?? ''}`);
      });
      console.log('\nRe-run with: node scripts/sync-hourly-wage.cjs --org <ORG_ID> [--month YYYY-MM] [--mode missing|all] --yes');
      process.exit(0);
    }

    const orgRef = db.collection('organizations').doc(org);
    const orgDoc = await orgRef.get();
    if (!orgDoc.exists) throw new Error(`Organization not found: ${org}`);
    const orgData = orgDoc.data() || {};
    const defWRaw = orgData.defaultHourlyWage;
    const defW = typeof defWRaw === 'number' ? defWRaw : Number(defWRaw);

    const membersSnap = await orgRef.collection('members').get();
    const memberWage = new Map();
    membersSnap.forEach(d => {
      const w = d.data().hourlyWage;
      const num = typeof w === 'number' ? w : Number(w);
      if (num && !Number.isNaN(num) && num > 0) memberWage.set(d.id, num);
    });

    const { startKey, endKey } = monthRange(month);
    console.log(`[sync-hourly-wage] org=${org} month=${month || '(current)'} range ${startKey} .. ${endKey}`);

    const q = db.collection('timecards')
      .where('organizationId','==',org)
      .where('dateKey','>=',startKey)
      .where('dateKey','<',endKey)
      .orderBy('dateKey','asc');

    const tSnap = await q.get();
    if (tSnap.empty) {
      console.log('No timecards in range.');
      process.exit(0);
    }

    const updates = [];
    tSnap.forEach(d => {
      const tc = d.data() || {};
      const current = tc.hourlyWage;
      const currentNum = typeof current === 'number' ? current : Number(current);
      const resolved = memberWage.get(tc.userId) || (defW && !Number.isNaN(defW) && defW > 0 ? defW : undefined);

      if (!resolved) return; // nothing to apply

      const needUpdate = mode === 'all'
        ? (currentNum !== resolved)
        : (!currentNum || Number.isNaN(currentNum) || currentNum <= 0);

      if (needUpdate) {
        updates.push({ id: d.id, from: currentNum, to: resolved });
      }
    });

    if (updates.length === 0) {
      console.log('No documents to update.');
      process.exit(0);
    }

    console.log(`Planned updates: ${updates.length}`);
    console.table(updates.slice(0, 20));
    if (updates.length > 20) console.log(`...and ${updates.length - 20} more`);

    if (!yes) {
      console.log('\nDry run. Add --yes to apply.');
      process.exit(0);
    }

    // Apply in batches of 400
    const batchSize = 400;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = db.batch();
      const slice = updates.slice(i, i + batchSize);
      slice.forEach(u => {
        batch.update(db.collection('timecards').doc(u.id), { hourlyWage: u.to, updatedAt: FieldValue.serverTimestamp() });
      });
      await batch.commit();
      console.log(`Committed ${i + slice.length}/${updates.length}`);
    }

    console.log('Done.');
    process.exit(0);
  } catch (e) {
    console.error('[sync-hourly-wage] Error:', e);
    process.exit(1);
  }
})();
