const crypto = require('crypto');
const { readCollection, writeCollection } = require('../db/mongoStore');
const { HttpError } = require('../utils/errors');
const { cleanString } = require('../utils/validators');

const defaultVenue = {
  id: 'akagera',
  ownerId: null,
  name: 'Akagera Safari Lodge Event Space',
  contactPerson: 'Jean Damascene Nkurunziza',
  phone: '+250 788 000 000',
  email: 'contact@akageralodge.rw',
  category: 'Grasslands Earth Collection',
  label: 'Indoor/Outdoor',
  location: 'Akagera National Park, Rwanda',
  province: 'Eastern Province',
  setting: 'National Park',
  description: 'Perched on a ridge overlooking Lake Ihema, the Akagera Safari Lodge Event Space offers an unparalleled fusion of wild adventure and high-end sophistication.',
  capacity: 'Up to 250',
  price: 'RWF 1,250,000',
  cleaningFee: 'RWF 50,000',
  decorFee: 'RWF 200,000',
  heroImage: 'https://images.pexels.com/photos/260922/pexels-photo-260922.jpeg?auto=compress&cs=tinysrgb&w=1400',
  heroMediaType: 'image',
  galleryImages: [
    'https://images.pexels.com/photos/271624/pexels-photo-271624.jpeg?auto=compress&cs=tinysrgb&w=800',
    'https://images.pexels.com/photos/417074/pexels-photo-417074.jpeg?auto=compress&cs=tinysrgb&w=800',
  ],
  galleryMedia: [
    { url: 'https://images.pexels.com/photos/271624/pexels-photo-271624.jpeg?auto=compress&cs=tinysrgb&w=800', type: 'image' },
    { url: 'https://images.pexels.com/photos/417074/pexels-photo-417074.jpeg?auto=compress&cs=tinysrgb&w=800', type: 'image' },
  ],
  addons: [
    { id: 'executive-catering', name: 'Executive Catering', description: 'Premium 5-course plated service with dedicated waitstaff.', amount: 450000 },
    { id: 'floral-decor', name: 'Floral & Decor Package', description: 'Custom centerpiece arrangements and ambient lighting design.', amount: 250000 },
    { id: 'event-photography', name: 'Event Photography', description: '4 hours of professional coverage and edited digital gallery.', amount: 150000 },
    { id: 'premium-av', name: 'Premium Audiovisual Suite', description: 'Projectors, surround sound, lighting, and mic setup.', amount: 200000 },
  ],
  amenities: [
    { icon: 'P', title: 'Valet Service', body: 'Professional parking for up to 100 private vehicles.' },
    { icon: 'WiFi', title: 'Fiber Internet', body: 'High-speed connectivity for event teams and guests.' },
    { icon: 'AV', title: 'Audio Visual', body: 'Presentation sound, lighting, and screen support.' },
    { icon: 'Food', title: 'Safari Catering', body: 'World-class cuisine with a modern Rwandan twist.' },
    { icon: 'Power', title: 'Gen-set Backup', body: 'Uninterrupted power for your critical event moments.' },
    { icon: 'Decor', title: 'Traditional Decor', body: 'Curated imigongo and local craft styling options.' },
  ],
  tags: ['Fiber Internet', 'Catering', '250 guests'],
  rating: '4.9',
  reviews: 32,
  status: 'Approved',
  tier: 'Excellence Hub',
  tin: '102345678',
  rdbNumber: '100234567',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function withVenueDefaults(venue) {
  return {
    ...venue,
    addons: Array.isArray(venue.addons) ? venue.addons : [],
  };
}

function withDefaultVenue(venues) {
  const normalizedVenues = venues.map(withVenueDefaults);
  return normalizedVenues.some((venue) => venue.id === defaultVenue.id) ? normalizedVenues : [defaultVenue, ...normalizedVenues];
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

async function listVenues(filters = {}) {
  const venues = withDefaultVenue(await readCollection('venues'));
  return venues.filter((venue) => {
    if (filters.ownerId && venue.ownerId !== filters.ownerId) return false;
    if (filters.province && venue.province !== filters.province) return false;
    if (filters.status && venue.status !== filters.status) return false;
    return true;
  });
}

async function getVenue(id) {
  const venues = withDefaultVenue(await readCollection('venues'));
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

module.exports = { createVenue, deleteVenue, getVenue, listVenues, updateVenue };
