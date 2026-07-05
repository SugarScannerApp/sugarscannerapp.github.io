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
    const { subscriberEmail, stripeCustomerId, referralCode } = JSON.parse(event.body);

    if (!subscriberEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Subscriber email is required' })
      };
    }

    // Verify reward is legitimate in database
    const { data: referral, error: lookupError } = await supabase
      .from('referrals')
      .select('*')
      .eq('subscriber_email', subscriberEmail)
      .single();

    if (lookupError || !referral) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Referral record not found' })
      };
    }

    if (referral.referral_count < 3) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Reward threshold not reached' })
      };
    }

    // Log reward details for Netlify function logs
    console.log('==========================================');
    console.log('🎉 SUGAR SCANNER REFERRAL REWARD EARNED!');
    console.log('==========================================');
    console.log(`Subscriber Email: ${subscriberEmail}`);
    console.log(`Referral Code: ${referralCode}`);
    console.log(`Stripe Customer ID: ${stripeCustomerId}`);
    console.log(`Referral Count: ${referral.referral_count}`);
    console.log(`Action Required: Add 3 months free in Stripe`);
    console.log(`Stripe Dashboard: https://dashboard.stripe.com/customers/${stripeCustomerId}`);
    console.log('==========================================');

    // Get all referral uses for this code
    const { data: uses } = await supabase
      .from('referral_uses')
      .select('*')
      .eq('referral_code', referralCode);

    console.log('Referred subscribers:');
    if (uses) {
      uses.forEach((use, index) => {
        console.log(`${index + 1}. ${use.new_subscriber_email} — ${new Date(use.used_at).toLocaleDateString()}`);
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Reward notification logged successfully',
        subscriber_email: subscriberEmail,
        stripe_customer_id: stripeCustomerId,
        referral_count: referral.referral_count,
        action_required: 'Add 3 months free in Stripe dashboard'
      })
    };

  } catch (error) {
    console.error('Error sending reward notification:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to send reward notification' })
    };
  }
};
