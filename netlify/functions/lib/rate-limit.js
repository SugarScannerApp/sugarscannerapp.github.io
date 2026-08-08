// Server-side rate limiting for the free-scan cap on analyze.js.
// Two layers, both backed by Netlify Blobs (no new DB/dependency):
//
//   scans:{anonId}  -> { count, firstSeen }   lifetime cap per signed anonymous visitor ID
//   ip:{hashedIp}   -> { count, windowStart }  rolling-24h coarse backstop per IP
//
// The per-ID cap is what most users hit. The IP backstop exists only to catch
// someone clearing localStorage between batches of 3 scans to mint a fresh ID
// each time — it intentionally does not defeat VPNs/shared IPs beyond that.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const FREE_SCAN_LIMIT = 3;
const IP_DAILY_LIMIT = 18;
const IP_WINDOW_MS = 24 * 60 * 60 * 1000;
const STORE_NAME = 'scan-limits';

function getScanStore() {
    return getStore(STORE_NAME);
}

// Hash the IP before it ever touches storage — we only need to compare IPs,
// never to recover or display them.
function hashIp(ip) {
    const salt = process.env.IP_HASH_SALT || 'sugar-scanner-ip-salt';
    return crypto.createHash('sha256').update(salt + '|' + ip).digest('hex');
}

function getClientIp(event) {
    const headers = event.headers || {};
    const nfIp = headers['x-nf-client-connection-ip'];
    if (nfIp) return nfIp.trim();
    const forwarded = headers['x-forwarded-for'] || '';
    return (forwarded.split(',')[0] || '').trim();
}

// Read-only checks. Do NOT mutate storage here — callers should only persist
// the increment after a successful analysis, so failed/errored scans (bad
// image, upstream API error) don't burn a free scan.
async function checkAnonLimit(store, anonId) {
    const key = 'scans:' + anonId;
    const existing = await store.get(key, { type: 'json' });
    const record = existing || { count: 0, firstSeen: Date.now() };
    return { key: key, record: record, overLimit: record.count >= FREE_SCAN_LIMIT };
}

async function checkIpLimit(store, ipHash) {
    const key = 'ip:' + ipHash;
    const now = Date.now();
    const existing = await store.get(key, { type: 'json' });
    const record = (existing && (now - existing.windowStart) < IP_WINDOW_MS)
      ? existing
          : { count: 0, windowStart: now };
    return { key: key, record: record, overLimit: record.count >= IP_DAILY_LIMIT };
}

async function recordSuccessfulScan(store, anonState, ipState) {
    anonState.record.count = (anonState.record.count || 0) + 1;
    if (!anonState.record.firstSeen) anonState.record.firstSeen = Date.now();
    ipState.record.count = (ipState.record.count || 0) + 1;
    if (!ipState.record.windowStart) ipState.record.windowStart = Date.now();
    await Promise.all([
          store.setJSON(anonState.key, anonState.record),
          store.setJSON(ipState.key, ipState.record)
        ]);
}

module.exports = {
    FREE_SCAN_LIMIT: FREE_SCAN_LIMIT,
    IP_DAILY_LIMIT: IP_DAILY_LIMIT,
    getScanStore: getScanStore,
    hashIp: hashIp,
    getClientIp: getClientIp,
    checkAnonLimit: checkAnonLimit,
    checkIpLimit: checkIpLimit,
    recordSuccessfulScan: recordSuccessfulScan
};
