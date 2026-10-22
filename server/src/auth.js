// src/auth.js — local JWT auth service (Section 3 "ModeB", Section 12)
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { storage } = require("./db");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_TTL = "7d";

function signup(username, password, email) {
  if (!username || !password) throw new Error("Username and password are required.");
  if (storage.getUserByUsername(username)) throw new Error("Username already taken.");
  const passwordHash = bcrypt.hashSync(password, 10);
  const user = {
    userId: uuidv4(),
    username,
    email: email || null,
    passwordHash,
    ratingBlitz: 1200,
    ratingRapid: 1200,
    ratingBullet: 1200,
    createdAt: Date.now(),
  };
  storage.createUser(user);
  return issueToken(user);
}

function login(username, password) {
  const user = storage.getUserByUsername(username);
  if (!user) throw new Error("Invalid username or password.");
  if (!bcrypt.compareSync(password, user.passwordHash)) throw new Error("Invalid username or password.");
  return issueToken(user);
}

function issueToken(user) {
  const token = jwt.sign({ userId: user.userId, username: user.username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  return { token, user: publicUser(user) };
}

function publicUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { signup, login, verifyToken, publicUser, JWT_SECRET };
