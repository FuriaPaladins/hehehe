const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Update this to your desired redirect URL
const TARGET_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

app.use((req, res) => {
    console.log(`Redirecting request from ${req.url} to ${TARGET_URL}`);
    res.redirect(TARGET_URL);
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
    console.log(`Redirecting all traffic to: ${TARGET_URL}`);
});
