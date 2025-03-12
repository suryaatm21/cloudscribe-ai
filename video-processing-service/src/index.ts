import express from 'express';

const app = express();
const port = 3000; /* default port for express apps */

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});