const crypto = require('crypto');
const { readCollection, writeCollection } = require('../db/mongoStore');
const { HttpError } = require('../utils/errors');
const { cleanString } = require('../utils/validators');

const fallbackHeroImage = 'https://images.pexels.com/photos/261102/pexels-photo-261102.jpeg?auto=compress&cs=tinysrgb&w=1200';

function withVenueDefaults(venue) {
  return {
    ...venue,
    addons: Array.isArray(venue.addons) ? venue.addons : [],
  };
}

function compactVenueForList(venue) {
  return {
    ...venue,
    heroImage: venue.heroImage || fallbackHeroImage,
    galleryImages: Array.isArray(venue.galleryImages)
      ? venue.galleryImages.filter((item) => typeof item === 'string' && item)
      : [],
    galleryMedia: Array.isArray(venue.galleryMedia)
      ? venue.galleryMedia.filter((item) => item?.url)
      : [],
    amenities: [],
    addons: [],
    contactPerson: '',
    phone: '',
    email: '',
    cleaningFee: '',
    decorFee: '',
    tin: '',
    rdbNumber: '',
  };
}

function slugify(value) {
  const slug = cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || crypto.randomUUID();
}

function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const amount = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function normalizeCoordinate(value, fieldName, min, max, existing = '') {
  const raw = cleanString(value || existing || '');
  if (!raw) return '';

  const coordinate = Number(raw);
  if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
    throw new HttpError(400, `${fieldName} must be between ${min} and ${max}.`);
  }

  return String(coordinate);
}

function normalizeAddons(addons, existingAddons = []) {
  const source = Array.isArray(addons) ? addons : existingAddons;
  return source
    .map((addon) => {
      const name = cleanString(addon?.name || addon?.title);
      if (!name) return null;

      return {
        id: cleanString(addon?.id) || slugify(name),
        name,
        description: cleanString(addon?.description || addon?.body),
        amount: parseMoney(addon?.amount || addon?.price),
      };
    })
    .filter((addon) => addon && addon.amount > 0);
}

function normalizeVenue(input, ownerId, existing = {}) {
  const name = cleanString(input.name || existing.name);
  if (!name) throw new HttpError(400, 'Venue name is required.');

  return {
    ...existing,
    id: existing.id || slugify(name),
    ownerId: existing.ownerId || ownerId,
    name,
    contactPerson: cleanString(input.contactPerson || existing.contactPerson || ''),
    phone: cleanString(input.phone || existing.phone || ''),
    email: cleanString(input.email || existing.email || ''),
    latitude: normalizeCoordinate(input.latitude, 'Latitude', -90, 90, existing.latitude),
    longitude: normalizeCoordinate(input.longitude, 'Longitude', -180, 180, existing.longitude),
    category: cleanString(input.category || existing.category || 'Event Venue'),
    label: cleanString(input.label || input.category || existing.label || 'Event Venue'),
    location: cleanString(input.location || existing.location || 'Rwanda'),
    province: cleanString(input.province || existing.province || 'Kigali City'),
    setting: cleanString(input.setting || existing.setting || 'Urban Venue'),
    description: cleanString(input.description || existing.description || ''),
    capacity: cleanString(input.capacity || existing.capacity || 'Capacity on request'),
    price: cleanString(input.price || existing.price || 'RWF 0'),
    cleaningFee: cleanString(input.cleaningFee || existing.cleaningFee || 'RWF 0'),
    decorFee: cleanString(input.decorFee || existing.decorFee || 'RWF 0'),
    heroImage: cleanString(input.heroImage || existing.heroImage || ''),
    heroMediaType: input.heroMediaType === 'video' ? 'video' : 'image',
    galleryImages: Array.isArray(input.galleryImages) ? input.galleryImages : existing.galleryImages || [],
    galleryMedia: Array.isArray(input.galleryMedia) ? input.galleryMedia : existing.galleryMedia || [],
    addons: normalizeAddons(input.addons, existing.addons || []),
    amenities: Array.isArray(input.amenities) ? input.amenities : existing.amenities || [],
    tags: Array.isArray(input.tags) ? input.tags : existing.tags || [],
    status: existing.status || 'pending',
    tier: cleanString(input.tier || existing.tier || 'New Partner'),
    tin: cleanString(input.tin || existing.tin || ''),
    rdbNumber: cleanString(input.rdbNumber || existing.rdbNumber || ''),
    rating: existing.rating || 'New',
    reviews: existing.reviews || 0,
    updatedAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString(),
  };
}

async function listVenues(filters = {}, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 60;
  const skip = Number.isFinite(options.skip) ? options.skip : 0;

  const venues = (await readCollection('venues')).map(withVenueDefaults).map(compactVenueForList);
  const filtered = venues.filter((venue) => {
    if (filters.ownerId && venue.ownerId !== filters.ownerId) return false;
    if (filters.province && venue.province !== filters.province) return false;
    if (filters.status && venue.status !== filters.status) return false;
    return true;
  });

  return filtered
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(skip, skip + limit);
}

async function getVenue(id) {
  const venues = (await readCollection('venues')).map(withVenueDefaults);
  const venue = venues.find((item) => item.id === id);
  if (!venue) throw new HttpError(404, 'Venue not found.');
  return venue;
}

async function createVenue(input, ownerId) {
  const venues = await readCollection('venues');
  const venue = normalizeVenue(input, ownerId);
  const existingId = venues.some((item) => item.id === venue.id);
  if (existingId) venue.id = `${venue.id}-${crypto.randomUUID().slice(0, 8)}`;

  venues.unshift(venue);
  await writeCollection('venues', venues);
  return venue;
}

async function updateVenue(id, input, user) {
  const venues = await readCollection('venues');
  const index = venues.findIndex((item) => item.id === id);
  if (index === -1) throw new HttpError(404, 'Venue not found.');
  if (venues[index].ownerId !== user.id && user.role !== 'admin') {
    throw new HttpError(403, 'You can only update your own venues.');
  }

  venues[index] = normalizeVenue(input, venues[index].ownerId, venues[index]);
  await writeCollection('venues', venues);
  return venues[index];
}

async function deleteVenue(id, user) {
  const venues = await readCollection('venues');
  const venue = venues.find((item) => item.id === id);
  if (!venue) throw new HttpError(404, 'Venue not found.');
  if (venue.ownerId !== user.id && user.role !== 'admin') {
    throw new HttpError(403, 'You can only delete your own venues.');
  }

  await writeCollection('venues', venues.filter((item) => item.id !== id));
}

async function updateVenueReviewStats(id, rating, reviews) {
  const venues = await readCollection('venues');
  const index = venues.findIndex((item) => item.id === id);
  const updatedAt = new Date().toISOString();

  if (index === -1) {
    throw new HttpError(404, 'Venue not found.');
  } else {
    venues[index] = {
      ...venues[index],
      rating,
      reviews,
      updatedAt,
    };
  }

  await writeCollection('venues', venues);
}

module.exports = { createVenue, deleteVenue, getVenue, listVenues, updateVenue, updateVenueReviewStats };
