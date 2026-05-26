const config = require('../config');
const { listVenues } = require('./venueService');
const { HttpError } = require('../utils/errors');
const { cleanString } = require('../utils/validators');

function compactVenue(venue) {
  return {
    id: venue.id,
    name: venue.name,
    category: venue.category,
    location: venue.location,
    province: venue.province,
    setting: venue.setting,
    capacity: venue.capacity,
    price: venue.price,
    rating: venue.rating,
    reviews: venue.reviews,
    status: venue.status,
    description: venue.description,
  };
}

function getOutputText(response) {
  if (response.output_text) return response.output_text;
  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function parseAiJson(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (__error) {
      return null;
    }
  }
}

async function askVenueAssistant(input = {}) {
  if (!config.openAiApiKey) {
    throw new HttpError(503, 'AI chat is not configured. Add OPENAI_API_KEY to backend/.env and restart the backend.');
  }

  const message = cleanString(input.message);
  if (!message) throw new HttpError(400, 'Message is required.');

  const venues = await listVenues();
  const venueContext = venues.slice(0, 25).map(compactVenue);
  const history = Array.isArray(input.history)
    ? input.history.slice(-8).map((item) => ({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: cleanString(item.content || item.text),
      })).filter((item) => item.content)
    : [];
  const prompt = [
    'Conversation history:',
    history.length
      ? history.map((item) => `${item.role}: ${item.content}`).join('\n')
      : 'No previous messages.',
    '',
    'Customer message:',
    message,
    '',
    'Live venue records JSON:',
    JSON.stringify(venueContext),
  ].join('\n');

  const requestBody = {
    model: config.openAiModel,
    instructions: [
      'You are Smart Event Venue Assistant for customers browsing Rwandan event venues.',
      'Use only the provided live venue records for recommendations.',
      'Be concise, helpful, and practical. Ask one follow-up question only when needed.',
      'Return valid JSON only with this shape: {"reply":"string","recommendedVenueIds":["id"]}.',
      'Choose up to three recommendedVenueIds from the venue records. Do not invent venue IDs.',
    ].join(' '),
    input: prompt,
    max_output_tokens: 650,
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messageText = data.error?.message || '';
    if (/input_text/i.test(messageText)) {
      return askVenueAssistantWithChatCompletions(prompt, venues);
    }
    throw new HttpError(response.status, messageText || 'AI assistant request failed.');
  }

  const text = getOutputText(data);
  const parsed = parseAiJson(text);
  const recommendedIds = Array.isArray(parsed?.recommendedVenueIds) ? parsed.recommendedVenueIds : [];
  const recommendedVenues = recommendedIds
    .map((id) => venues.find((venue) => venue.id === id))
    .filter(Boolean);

  return {
    reply: cleanString(parsed?.reply) || text || 'I can help compare venues by guest count, budget, location, and event style.',
    recommendations: recommendedVenues,
  };
}

async function askVenueAssistantWithChatCompletions(prompt, venues) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.openAiModel,
      messages: [
        {
          role: 'system',
          content: [
            'You are Smart Event Venue Assistant for customers browsing Rwandan event venues.',
            'Use only the provided live venue records for recommendations.',
            'Return valid JSON only with this shape: {"reply":"string","recommendedVenueIds":["id"]}.',
          ].join(' '),
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 650,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(response.status, data.error?.message || 'AI assistant request failed.');
  }

  const text = data.choices?.[0]?.message?.content || '';
  const parsed = parseAiJson(text);
  const recommendedIds = Array.isArray(parsed?.recommendedVenueIds) ? parsed.recommendedVenueIds : [];
  const recommendedVenues = recommendedIds
    .map((id) => venues.find((venue) => venue.id === id))
    .filter(Boolean);

  return {
    reply: cleanString(parsed?.reply) || text || 'I can help compare venues by guest count, budget, location, and event style.',
    recommendations: recommendedVenues,
  };
}

module.exports = { askVenueAssistant };
