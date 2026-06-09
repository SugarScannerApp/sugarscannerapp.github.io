exports.handler = async function(event, context) {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Anthropic API error: ' + data.error.message })
      };
    }

    const raw = (data.content || []).map(i => i.text || '').join('');
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };

  } catch(e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Network error: ' + (e.message || 'Unknown error') })
    };
  }
};
