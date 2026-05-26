const express = require('express');
const { askVenueAssistant } = require('../services/aiService');
const { asyncHandler } = require('../utils/errors');

const router = express.Router();

router.post('/venue-chat', asyncHandler(async (req, res) => {
  const result = await askVenueAssistant(req.body);
  res.setHeader('X-Smart-Event-AI-Version', 'prompt-input-v2');
  res.json(result);
}));

module.exports = router;
