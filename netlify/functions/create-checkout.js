exports.handler = async function(event, context) {
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

  const priceMap = {
    personal: 'price_1TgniBKXJuMb8whsoJr28zF3',
    family: 'price_1TgnisKXJuMb8whsGlUi2E5t',
    annual: 'price_1Tgnj9KXJuMb8whsc1kTzmmT'
  };

  const priceId = priceMap[body.plan];
  if (!priceId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid plan' })
    };
  }

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        'mode': 'subscription',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        'success_url': 'https://www.sugarscannerapp.com?subscribed=true',
        'cancel_url': 'https://www.sugarscannerapp.com?cancelled=true',
        'allow_promotion_codes': 'true'
      })
    });

    const session = await response.json();

    if (session.error) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: session.error.message })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url })
    };

  } catch(e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || 'Something went wrong' })
    };
  }
};
