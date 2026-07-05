const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'SS-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { email, stripeCustomerId } = JSON.parse(event.body);

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email is required' })
      };
    }

    // Check if referral code already exists for this email
    const { data: existing } = await supabase
      .from('referrals')
      .select('referral_code')
      .eq('subscriber_email', email)
      .single();

    if (existing) {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          referral_code: existing.referral_code,
          message: 'Existing code returned'
        })
      };
    }

    // Generate unique code
    let referralCode;
    let isUnique = false;

    while (!isUnique) {
      referralCode = generateCode();
      const { data } = await supabase
        .from('referrals')
        .select('referral_code')
        .eq('referral_code', referralCode)
        .single();
      if (!data) isUnique = true;
    }

    // Save to database
    const { error } = await supabase
      .from('referrals')
      .insert({
        subscriber_email: email,
        referral_code: referralCode,
        stripe_customer_id: stripeCustomerId || null,
        referral_count: 0,
        reward_given: false
      });

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({
        referral_code: referralCode,
        message: 'Referral code generated successfully'
      })
    };

  } catch (error) {
    console.error('Error generating referral code:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate referral code' })
    };
  }
};
