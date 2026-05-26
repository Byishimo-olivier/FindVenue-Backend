const { readCollection, writeCollection } = require('../db/mongoStore');
const { getVenue } = require('./venueService');
const { HttpError } = require('../utils/errors');
const { cleanString } = require('../utils/validators');

async function listFavorites(user) {
  const favorites = await readCollection('favorites');
  return favorites.filter((favorite) => favorite.userId === user.id);
}

async function listFavoriteVenueIds(user) {
  const favorites = await listFavorites(user);
  return favorites.map((favorite) => favorite.venueId);
}

async function addFavorite(user, venueId) {
  const id = cleanString(venueId);
  if (!id) throw new HttpError(400, 'Venue ID is required.');
  await getVenue(id);

  const favorites = await readCollection('favorites');
  const existing = favorites.find((favorite) => favorite.userId === user.id && favorite.venueId === id);
  if (existing) return existing;

  const favorite = {
    id: `${user.id}:${id}`,
    userId: user.id,
    venueId: id,
    createdAt: new Date().toISOString(),
  };
  favorites.unshift(favorite);
  await writeCollection('favorites', favorites);
  return favorite;
}

async function removeFavorite(user, venueId) {
  const id = cleanString(venueId);
  if (!id) throw new HttpError(400, 'Venue ID is required.');

  const favorites = await readCollection('favorites');
  await writeCollection('favorites', favorites.filter((favorite) => favorite.userId !== user.id || favorite.venueId !== id));
}

module.exports = { addFavorite, listFavoriteVenueIds, listFavorites, removeFavorite };
