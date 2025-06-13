const express = require('express');
const logger = require('./utils/logger');

const app = express();
const port = 3000;

app.get('/', (req, res) => {
  logger.info('Hello World!');
  res.send('Hello World!');
});

app.listen(port, () => {
  logger.info(`Server listening at http://localhost:${port}`);
});
