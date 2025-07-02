const express = require('express');
const app = express();
const port = 8888;

app.get('/hma-mock', (req, res) => {
  res.json([
    {
      content_id: "event123",
      matched_hash: "abc123",
      room_id: "!xxUTkdiszaFvYkvLLE:matrix.org",
      sender: "@fakespammer:matrix.org"
    }
  ]);
});

app.listen(port, () => {
  console.log(`✅ HMA mock server running at http://localhost:${port}/hma-mock`);
});
