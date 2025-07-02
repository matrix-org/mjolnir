const express = require("express");
const fetch = require("node-fetch"); // Install with `npm install node-fetch`
const app = express();
const PORT = 8888;

// This is where Mjolnir will query
app.get("/hma-mock", async (req, res) => {
  try {
    const response = await fetch("http://localhost:5000/m/lookup");
    const rawData = await response.json();

    // Transform HMA response into Mjolnir plugin format
    // Example expected by Mjolnir:
    // [
    //   {
    //     content_id: "event123",
    //     matched_hash: "abc123",
    //     room_id: "!room:matrix.org",
    //     sender: "@user:matrix.org"
    //   }
    // ]
    const translated = (rawData.matches || []).map((match) => ({
      content_id: match.content_id || "unknown_content",
      matched_hash: match.hash || "unknown_hash",
      room_id: match.room_id || "!unknown:matrix.org",
      sender: match.sender || "@unknown:matrix.org",
    }));

    res.json(translated);
  } catch (err) {
    console.error("❌ Failed to fetch from HMA:", err);
    res.status(500).send("Error fetching from HMA backend.");
  }
});

app.listen(PORT, () => {
  console.log(`✅ HMA plugin bridge running at http://localhost:${PORT}/hma-mock`);
});
