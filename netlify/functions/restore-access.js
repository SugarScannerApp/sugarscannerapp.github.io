// Restore-access endpoint: a subscriber who lost their local "paid" flag
// (new device, cleared cache, browser switch) can re-prove they're a real
// Stripe subscriber by entering the email they checked out with. If Stripe
// confirms an active (or trialing) subscription, we issue a signed access
// token the client stores instead of a plain localStorage boolean.
//
// This does not create an account system — it's a stateless, re-derivable
// proof tied to Stripe as the source of truth.

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

    const email = (body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
          return {
                  statusCode: 400,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ error: 'A valid email is required' })
          };
    }

    const authHeaders = { 'Authorization': 'Bearer ' + STRIPE_SECRET_KEY };

    try {
          const custResp = await fetch('https://api.stripe.com/v1/customers?' + new URLSearchParams({ email: email, limit: '5' }), { headers: authHeaders });
          const custData = await custResp.json();
          if (custData.error) throw new Error(custData.error.message);

      const customers = custData.data || [];
          if (customers.length === 0) {
                  return {
                            statusCode: 404,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ error: "We couldn't find a subscription for that email. Double-check the email you used at checkout, or email heather@sugarscannerapp.com." })
                  };
          }

      let activeSub = null;
          let matchedCustomer = null;

      for (const customer of customers) {
              for (const status of ['active', 'trialing']) {
                        const subResp = await fetch('https://api.stripe.com/v1/subscriptions?' + new URLSearchParams({ customer: customer.id, status: status, limit: '1' }), { headers: authHeaders });
                        const subData = await subResp.json();
                        if (subData.data && subData.data.length > 0) {
                                    activeSub = subData.data[0];
                                    matchedCustomer = customer;
                                    break;
                        }
              }
              if (activeSub) break;
      }

      if (!activeSub) {
              return {
                        statusCode: 404,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: "We found your account, but no active subscription on it. If that looks wrong, email heather@sugarscannerapp.com." })
              };
      }

      const now = Math.floor(Date.now() / 1000);
          const token = signToken({
                  email: email,
                  cus: matchedCustomer.id,
                  sub: activeSub.id,
                  iat: now,
                  exp: now + TOKEN_TTL_SECONDS
          });

      return {
              statusCode: 200,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: token, email: email })
      };
    } catch(e) {
          console.error('restore-access error:', e);
          return {
                  statusCode: 500,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ error: e.message || 'Something went wrong. Please try again or email heather@sugarscannerapp.com.' })
          };
    }
};
