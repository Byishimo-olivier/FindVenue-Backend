const fs = require('fs/promises');
const path = require('path');
const { MongoClient } = require('mongodb');
const config = require('../config');

let clientPromise;
let mongoClient;
let warnedAboutMongoFallback = false;
let mongoUnavailableUntil = 0;
const dataDir = path.resolve(__dirname, '..', '..', 'data');
const mongoConnectionTimeoutMs = Number(process.env.MONGO_CONNECTION_TIMEOUT_MS || 2500);
const mongoRetryCooldownMs = Number(process.env.MONGO_RETRY_COOLDOWN_MS || 60000);

function isMongoEnabled() {
  return String(process.env.USE_MONGO || '').toLowerCase() === 'true';
}

function shouldUseMongo() {
  return config.dbUrl && isMongoEnabled() && Date.now() >= mongoUnavailableUntil;
}

function withMongoConnectionHelp(error) {
  if (!/ssl|tls|alert internal error|server selection/i.test(error.message || '')) {
    return error;
  }

  error.message = `${error.message}\n\nMongoDB connection failed before authentication. Check Atlas Network Access for this machine's IP address, and use Node 20 LTS if Node/OpenSSL 3 keeps failing the TLS handshake.`;
  return error;
}

function getClient() {
  if (!clientPromise) {
    if (!shouldUseMongo()) {
      return null;
    }

    const client = new MongoClient(config.dbUrl, {
      serverSelectionTimeoutMS: mongoConnectionTimeoutMs,
    });
    mongoClient = client;
    clientPromise = client.connect().catch((error) => {
      clientPromise = undefined;
      mongoClient = undefined;
      throw withMongoConnectionHelp(error);
    });
  }
  return clientPromise;
}

async function getDb() {
  let client;
  try {
    const pendingClient = getClient();
    client = pendingClient && typeof pendingClient.then === 'function'
      ? await pendingClient
      : pendingClient;
  } catch (error) {
    if (error.code === 'MONGO_CONNECTION_TIMEOUT' && mongoClient) {
      mongoClient.close(true).catch(() => {});
    }
    clientPromise = undefined;
    mongoClient = undefined;
    mongoUnavailableUntil = Date.now() + mongoRetryCooldownMs;
    if (!warnedAboutMongoFallback) {
      warnedAboutMongoFallback = true;
      console.warn(`MongoDB unavailable; ${isMongoEnabled() ? 'not using' : 'using'} local JSON data store.\n   Error: ${error.message}`);
    }
    if (isMongoEnabled()) {
      throw error;
    }
    return null;
  }

  if (!client) {
    if (isMongoEnabled()) {
      if (!config.dbUrl) {
        throw new Error('MongoDB is enabled, but no MongoDB connection string is configured.');
      }
      throw new Error('MongoDB is temporarily unavailable after a previous connection failure. Restart the backend or wait for the retry cooldown.');
    }
    return null;
  }

  console.log(`Connected to MongoDB database "${config.dbName}"`);
  return client.db(config.dbName);
}

function cleanDocument(document) {
  if (!document) return document;
  const { _id, ...rest } = document;
  return rest;
}

async function readCollection(name) {
  const db = await getDb();
  if (!db) {
    try {
      const content = await fs.readFile(path.join(dataDir, `${name}.json`), 'utf8');
      const data = JSON.parse(content);
      console.log(`Read ${data.length} ${name} from JSON file`);
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`${name}.json not found, starting with empty collection`);
        return [];
      }
      console.error(`Failed to read ${name}.json:`, error);
      throw error;
    }
  }

  const rows = await db.collection(name).find({}).toArray();
  return rows.map(cleanDocument);
}

async function writeCollection(name, rows) {
  const db = await getDb();
  if (!db) {
    try {
      await fs.mkdir(dataDir, { recursive: true });
      const filePath = path.join(dataDir, `${name}.json`);
      await fs.writeFile(filePath, JSON.stringify(rows, null, 2));
      console.log(`Saved ${rows.length} ${name} to ${filePath}`);
    } catch (error) {
      console.error(`Failed to write ${name}.json:`, error);
      throw error;
    }
    return;
  }

  const collection = db.collection(name);
  await collection.deleteMany({});

  if (rows.length > 0) {
    await collection.insertMany(rows.map((row) => ({ ...row })));
  }
}

async function closeMongo() {
  if (!clientPromise) return;
  const client = await clientPromise;
  await client.close();
  clientPromise = undefined;
  mongoClient = undefined;
}

module.exports = { closeMongo, readCollection, writeCollection };
