// Runs right after a Stripe Checkout redirect. create-checkout.js appends
// {CHECKOUT_SESSION_ID} to the success_url, so instead of blindly trusting a
// "?subscribed=true" query param (the old behavior, forgeable by anyone),
// we look the session up in Stripe, confirm it actually completed with an
// active subscription attached, and only then issue a signed access token.

const { signToken } = require('./lib/access-token');

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
          return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    if (!STRIPE_SECRET_KEY) {
          return {
                  statusCode: 500,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ error: 'Stripe not configured' })
          };
    }

    let body;
    try {
          body = JSON.parse(event.body);
    } catch(e) {
          return {
                  statusCode: 400,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ error: 'Invalid request' })
          };
    }

    const sessionId = body.sessionId;
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
          return {
                  statusCode: 400,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ error: 'Invalid session' })
          };
    }

    const authHeaders = { 'Authorization': 'Bearer ' + STRIPE_SECRET_KEY };

    try {
          const sessResp = await fetch('https://api.stripe.com/v1/checkout/sessions/' + sessionId + '?' + new URLSearchParams({ 'expand[]': 'customer' }), { headers: authHeaders });
          const session = await sessResp.json();
          if (session.error) throw new Error(session.error.message);

      const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
          if (!paid && session.status !== 'complete') {
                  return {
                            statusCode: 402,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ error: 'Checkout not completed' })
                  };
          }

      const email = (session.customer_details && session.customer_details.email) ||
              (session.customer && session.customer.email) || '';
          const customerId = (session.customer && session.customer.id) ? session.customer.id : session.customer;
          const subscriptionId = session.subscription;

      if (!customerId || !subscriptionId) {
              return {
                        statusCode: 404,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'No subscription on this session' })
              };
      }

      const now = Math.floor(Date.now() / 1000);
          const token = signToken({
                  email: (email || '').toLowerCase(),
                  cus: customerId,
                  sub: subscriptionId,
                  iat: now,
                  exp: now + TOKEN_TTL_SECONDS
          });

      return {
              statusCode: 200,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: token, email: email })
      };
    } catch(e) {
          console.error('verify-checkout-session error:', e);
          return {
                  statusCode: 500,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ error: e.message || 'Something went wrong verifying your subscription.' })
          };
    }
};
