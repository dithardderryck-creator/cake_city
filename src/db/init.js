require('dotenv').config();
const { ensureDbInitialized } = require('./bootstrap');

ensureDbInitialized()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('DB init failed:', err.message);
    process.exit(1);
  });