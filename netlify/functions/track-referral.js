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
    const { referralCode, newSubscriberEmail } = JSON.parse(event.body);

    if (!referralCode || !newSubscriberEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Referral code and email are required' })
      };
    }

    // Check referral code exists
    const { data: referral, error: lookupError } = await supabase
      .from('referrals')
      .select('*')
      .eq('referral_code', referralCode.toUpperCase())
      .single();

    if (lookupError || !referral) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Referral code not found' })
      };
    }

    // Make sure someone isn't using their own code
    if (referral.subscriber_email === newSubscriberEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'You cannot use your own referral code' })
      };
    }

    // Check this email hasn't already used a referral code
    const { data: existingUse } = await supabase
      .from('referral_uses')
      .select('id')
      .eq('new_subscriber_email', newSubscriberEmail)
      .single();

    if (existingUse) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'This email has already used a referral code' })
      };
    }

    // Record the referral use
    const { error: insertError } = await supabase
      .from('referral_uses')
      .insert({
        referral_code: referralCode.toUpperCase(),
        new_subscriber_email: newSubscriberEmail,
        used_at: new Date().toISOString()
      });

    if (insertError) throw insertError;

    // Increment referral count
    const newCount = referral.referral_count + 1;
    const { error: updateError } = await supabase
      .from('referrals')
      .update({ referral_count: newCount })
      .eq('referral_code', referralCode.toUpperCase());

    if (updateError) throw updateError;

    // Check if reward threshold reached
    if (newCount >= 3 && !referral.reward_given) {
      // Mark reward as triggered
      await supabase
        .from('referrals')
        .update({ reward_given: true })
        .eq('referral_code', referralCode.toUpperCase());

      // Send notification email to Heather
      console.log(`🎉 REWARD TRIGGERED: ${referral.subscriber_email} has earned 3 months free! Stripe Customer ID: ${referral.stripe_customer_id}`);

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          referral_count: newCount,
          reward_triggered: true,
          message: `Reward triggered for ${referral.subscriber_email}`
        })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        referral_count: newCount,
        reward_triggered: false,
        referrals_remaining: 3 - newCount,
        message: `Referral recorded. ${3 - newCount} more needed for reward.`
      })
    };

  } catch (error) {
    console.error('Error tracking referral:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to track referral' })
    };
  }
};
