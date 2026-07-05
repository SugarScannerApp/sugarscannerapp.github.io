const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { email } = JSON.parse(event.body);

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email is required' })
      };
    }

    // Look up referral record by email
    const { data: referral, error } = await supabase
      .from('referrals')
      .select('*')
      .eq('subscriber_email', email.toLowerCase().trim())
      .single();

    if (error || !referral) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'No referral code found for this email' })
      };
    }

    // Get all referral uses for this code
    const { data: uses } = await supabase
      .from('referral_uses')
      .select('new_subscriber_email, used_at')
      .eq('referral_code', referral.referral_code);

    return {
      statusCode: 200,
      body: JSON.stringify({
        referral_code: referral.referral_code,
        referral_count: referral.referral_count,
        reward_given: referral.reward_given,
        referrals_remaining: Math.max(0, 3 - referral.referral_count),
        uses: uses || [],
        created_at: referral.created_at
      })
    };

  } catch (error) {
    console.error('Error looking up referral:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to look up referral code' })
    };
  }
};
