const express = require("express");
const { signup, login } = require("../auth");

const router = express.Router();

router.post("/signup", (req, res) => {
  try {
    const { username, password, email } = req.body;
    const result = signup(username, password, email);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/login", (req, res) => {
  try {
    const { username, password } = req.body;
    const result = login(username, password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

module.exports = router;
