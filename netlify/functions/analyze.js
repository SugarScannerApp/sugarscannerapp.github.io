// Free-scan gating: every call here does real, billed work (OCR + an
// Anthropic API call), so this endpoint can no longer trust the client's
// "3 free scans" counter — that lived only in localStorage and was trivially
// bypassable (incognito, clearing storage, or calling this function
// directly). Enforcement now happens here, server-side:
//
//   1. A valid signed paid-access token (from PR #2's restore-access /
//      verify-checkout-session flow) bypasses all limiting — unlimited scans.
//   2. Otherwise, a signed anonymous visitor ID (issued by this function on
//      first contact, stored client-side, sent back on every call) is capped
//      at FREE_SCAN_LIMIT lifetime scans via Netlify Blobs.
//   3. A coarser per-IP daily cap acts as a backstop against someone simply
//      clearing localStorage to mint a fresh anonymous ID every few scans.
//
// Counts are only incremented after a successful analysis, so a bad image or
// an upstream API error never burns someone's free scan.

const crypto = require('crypto');
const { signToken, verifyToken } = require('./lib/access-token');
const { connectLambda } = require('@netlify/blobs');
const {
    getScanStore,
    hashIp,
    getClientIp,
    checkAnonLimit,
    checkIpLimit,
    recordSuccessfulScan
} = require('./lib/rate-limit');

const ANON_ID_SECRET_ENV = 'ANON_ID_SECRET';
const ANON_ID_TTL_SECONDS = 60 * 60 * 24 * 365 * 5;

function issueAnonToken() {
    const now = Math.floor(Date.now() / 1000);
    const anonId = crypto.randomBytes(16).toString('hex');
    const token = signToken({ aid: anonId, iat: now, exp: now + ANON_ID_TTL_SECONDS }, ANON_ID_SECRET_ENV);
    return { anonId: anonId, token: token };
}

exports.handler = async function(event, context) {
        // @netlify/blobs needs this called first when a function uses the classic
        // Lambda-compatible handler signature (event, context) instead of the
        // newer Request/Response signature — without it, getStore() throws
        // MissingBlobsEnvironmentError even though the site has Blobs available.
        connectLambda(event);
    if (event.httpMethod !== 'POST') {
          return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    if (!ANTHROPIC_API_KEY) {
          return {
                  statusCode: 500,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ error: 'API key not configured on server' })
          };
    }

    let body;
    try {
          body = JSON.parse(event.body);
    } catch(e) {
          return {
                  statusCode: 400,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ error: 'Invalid request body' })
          };
    }

    if (!body.imageData) {
          return {
                  statusCode: 400,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ error: 'No image data received' })
          };
    }

    const reqHeaders = event.headers || {};

    const accessToken = reqHeaders['x-access-token'];
    const isPaid = !!(accessToken && verifyToken(accessToken));

    const incomingAnonToken = reqHeaders['x-anon-id'];
    const anonPayload = incomingAnonToken ? verifyToken(incomingAnonToken, ANON_ID_SECRET_ENV) : null;

    let anonId, issuedAnonToken;
    if (anonPayload && anonPayload.aid) {
          anonId = anonPayload.aid;
          issuedAnonToken = null;
    } else {
          const issued = issueAnonToken();
          anonId = issued.anonId;
          issuedAnonToken = issued.token;
    }

    const responseHeaders = { 'Content-Type': 'application/json' };
    if (issuedAnonToken) responseHeaders['X-Anon-Id'] = issuedAnonToken;

    let store, anonState, ipState;

    if (!isPaid) {
          try {
                  store = getScanStore();
                  const ip = getClientIp(event) || 'unknown';
                  const ipHash = hashIp(ip);

            anonState = await checkAnonLimit(store, anonId);
                  ipState = await checkIpLimit(store, ipHash);
          } catch (e) {
                  console.error('analyze.js: rate-limit check failed:', e);
                  return {
                            statusCode: 500,
                            headers: responseHeaders,
                            body: JSON.stringify({ error: 'Unable to verify scan limit right now. Please try again in a moment.' })
                  };
          }

      if (anonState.overLimit || ipState.overLimit) {
              return {
                        statusCode: 402,
                        headers: responseHeaders,
                        body: JSON.stringify({ error: "You've used your 3 free scans — subscribe for unlimited." })
              };
      }
    }

    try {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': ANTHROPIC_API_KEY,
                            'anthropic-version': '2023-06-01'
                  },
                  body: JSON.stringify({
                            model: 'claude-haiku-4-5-20251001',
                            max_tokens: 1500,
                            system: `You are a nutrition expert specializing in identifying hidden sugars in food ingredient labels. When given an image of an ingredient label, identify every ingredient that is a form of sugar, sweetener, or sugar alternative. Respond ONLY with valid JSON — no markdown fences, no preamble: { "ingredients_found": true, "sugar_alternatives": [ { "name": "exact name as on label", "common_name": "commonly known as", "type": "refined sugar | natural sugar | sugar alcohol | artificial sweetener | syrup | other", "gi_index": "numeric value or range, or N/A", "gi_category": "high (>70) | medium (56-69) | low (<55) | N/A", "health_effects": "2-3 sentences on health and metabolic impact", "how_processed": "brief description of how the body processes it" } ], "overall_sugar_load": "low | moderate | high", "summary": "1-2 sentence overall assessment" } If no ingredient label is visible, set ingredients_found to false and sugar_alternatives to [].`,
                            messages: [{
                                        role: 'user',
                                        content: [
                                          { type: 'image', source: { type: 'base64', media_type: body.mediaType || 'image/jpeg', data: body.imageData } },
                                          { type: 'text', text: 'Analyze this ingredient label for all sugar alternatives and sweeteners.' }
                                                    ]
                            }]
                  })
          });

      const data = await response.json();

      if (data.error) {
              return {
                        statusCode: 500,
                        headers: responseHeaders,
                        body: JSON.stringify({ error: 'Anthropic API error: ' + data.error.message })
              };
      }

      const raw = (data.content || []).map(i => i.text || '').join('');
          const clean = raw.replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(clean);

      if (!isPaid && store) {
              try {
                        await recordSuccessfulScan(store, anonState, ipState);
              } catch (e) {
                        console.error('analyze.js: rate-limit increment failed:', e);
              }
      }

      return {
              statusCode: 200,
              headers: responseHeaders,
              body: JSON.stringify(parsed)
      };

    } catch(e) {
          return {
                  statusCode: 500,
                  headers: responseHeaders,
                  body: JSON.stringify({ error: 'Network error: ' + (e.message || 'Unknown error') })
          };
    }
};
