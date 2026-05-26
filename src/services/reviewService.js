const crypto = require('crypto');
const { readCollection, writeCollection } = require('../db/mongoStore');
const { HttpError } = require('../utils/errors');
const { cleanString } = require('../utils/validators');
const { getVenue, updateVenueReviewStats } = require('./venueService');

function normalizeRating(value, field) {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpError(400, `${field} must be a whole number from 1 to 5.`);
  }
  return rating;
}

function publicReview(review) {
  return {
    id: review.id,
    venueId: review.venueId,
    reviewerName: review.reviewerName,
    reviewerRole: review.reviewerRole,
    eventType: review.eventType,
    title: review.title,
    body: review.body,
    rating: review.rating,
    cleanliness: review.cleanliness,
    service: review.service,
    value: review.value,
    location: review.location,
    mediaUrl: review.mediaUrl,
    createdAt: review.createdAt,
  };
}

function calculateSummary(reviews) {
  const count = reviews.length;
  if (!count) {
    return {
      average: 'New',
      count: 0,
      categories: {
        cleanliness: 'New',
        service: 'New',
        value: 'New',
        location: 'New',
      },
    };
  }

  const averageFor = (field) => (
    reviews.reduce((sum, review) => sum + Number(review[field] || 0), 0) / count
  ).toFixed(1);

  return {
    average: averageFor('rating'),
    count,
    categories: {
      cleanliness: averageFor('cleanliness'),
      service: averageFor('service'),
      value: averageFor('value'),
      location: averageFor('location'),
    },
  };
}

async function listVenueReviews(venueId) {
  await getVenue(venueId);
  const reviews = (await readCollection('reviews'))
    .filter((review) => review.venueId === venueId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  return {
    reviews: reviews.map(publicReview),
    summary: calculateSummary(reviews),
  };
}

async function createVenueReview(venueId, input, user) {
  await getVenue(venueId);

  const title = cleanString(input.title);
  const body = cleanString(input.body);
  if (!title) throw new HttpError(400, 'Review title is required.');
  if (body.length < 20) throw new HttpError(400, 'Review details must be at least 20 characters.');

  const now = new Date().toISOString();
  const reviews = await readCollection('reviews');
  const review = {
    id: crypto.randomUUID(),
    venueId,
    userId: user?.id || null,
    reviewerName: cleanString(input.reviewerName || user?.fullName || 'Guest Reviewer'),
    reviewerRole: cleanString(input.reviewerRole || input.eventType || 'Verified Guest'),
    eventType: cleanString(input.eventType || 'Event'),
    title,
    body,
    rating: normalizeRating(input.rating, 'Overall rating'),
    cleanliness: normalizeRating(input.cleanliness || input.rating, 'Cleanliness rating'),
    service: normalizeRating(input.service || input.rating, 'Service rating'),
    value: normalizeRating(input.value || input.rating, 'Value rating'),
    location: normalizeRating(input.location || input.rating, 'Location rating'),
    mediaUrl: cleanString(input.mediaUrl || ''),
    createdAt: now,
    updatedAt: now,
  };

  const nextReviews = [review, ...reviews];
  await writeCollection('reviews', nextReviews);

  const venueReviews = nextReviews.filter((item) => item.venueId === venueId);
  const summary = calculateSummary(venueReviews);
  await updateVenueReviewStats(venueId, summary.average, summary.count);

  return {
    review: publicReview(review),
    summary,
  };
}

module.exports = { createVenueReview, listVenueReviews };
