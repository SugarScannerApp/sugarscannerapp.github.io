// Shared helper for signing and verifying the lightweight subscriber access token.
// This is NOT a full auth system — it's a signed, expiring claim that says
// "the server confirmed an active Stripe subscription for this email at issue time."
// No npm dependency needed: uses Node's built-in crypto (HMAC-SHA256).
//
// Also reused (with a distinct secret) to sign the anonymous visitor ID that
// gates free scans server-side — see netlify/functions/lib/rate-limit.js.
// Pass a secretEnvVar name to sign/verify against a different secret than the
// default paid-access one; if that env var isn't set, we fall back to
// ACCESS_TOKEN_SECRET so a missing optional secret never breaks the function.

const crypto = require('crypto');

function base64url(buf) {
        return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) str += '=';
        return Buffer.from(str, 'base64');
}

function resolveSecret(secretEnvVar) {
        if (secretEnvVar && process.env[secretEnvVar]) return process.env[secretEnvVar];
        return process.env.ACCESS_TOKEN_SECRET;
}

// Signs a JSON-serializable payload. Returns a compact token: payload.signature
function signToken(payload, secretEnvVar) {
        const secret = resolveSecret(secretEnvVar);
        if (!secret) throw new Error((secretEnvVar || 'ACCESS_TOKEN_SECRET') + ' is not configured');
        const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
        const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
        return payloadB64 + '.' + base64url(sig);
}

// Verifies signature + expiry. Returns the decoded payload if valid, otherwise null.
function verifyToken(token, secretEnvVar) {
        const secret = resolveSecret(secretEnvVar);
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
