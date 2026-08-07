// Shared helper for signing and verifying the lightweight subscriber access token.
// This is NOT a full auth system — it's a signed, expiring claim that says
// "the server confirmed an active Stripe subscription for this email at issue time."
// No npm dependency needed: uses Node's built-in crypto (HMAC-SHA256).

const crypto = require('crypto');

function base64url(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Buffer.from(str, 'base64');
}

// Signs a JSON-serializable payload. Returns a compact token: payload.signature
function signToken(payload) {
    const secret = process.env.ACCESS_TOKEN_SECRET;
    if (!secret) throw new Error('ACCESS_TOKEN_SECRET is not configured');
    const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
    const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
    return payloadB64 + '.' + base64url(sig);
}

// Verifies signature + expiry. Returns the decoded payload if valid, otherwise null.
function verifyToken(token) {
    const secret = process.env.ACCESS_TOKEN_SECRET;
    if (!secret || !token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, sig] = parts;
    const expectedSig = base64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
          return null;
    }
    let payload;
    try {
          payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
    } catch (e) {
          return null;
    }
    if (!payload.exp || Date.now() / 1000 > payload.exp) return null;
    return payload;
}

module.exports = { signToken, verifyToken };
