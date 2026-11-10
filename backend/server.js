require('dotenv').config();

const dns = require('node:dns');
const mongoose = require('mongoose');
const { createApp, initializeDatabase, requireJwtSecret } = require('./src/app');

async function start() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required. Configure it in backend/.env.');
  }
  requireJwtSecret();
  const dnsServers = (process.env.DNS_SERVERS || '')
    .split(',')
    .map(server => server.trim())
    .filter(Boolean);
  if (dnsServers.length) dns.setServers(dnsServers);

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB_NAME || 'vignan_cafeteria',
    serverSelectionTimeoutMS: 10000,
  });
  await initializeDatabase();

  const port = Number(process.env.PORT) || 5000;
  const server = createApp().listen(port, '0.0.0.0', () => {
    console.log(`Vignan Cafeteria API listening on port ${port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch(error => {
  console.error(`Backend startup failed: ${error.message}`);
  process.exitCode = 1;
});
