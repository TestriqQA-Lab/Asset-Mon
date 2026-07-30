#!/usr/bin/env bash
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T api node -e '
const crypto = require("crypto");
const { authenticator } = require("otplib");
const encKey = process.env.ENCRYPTION_KEY;
const key = crypto.createHash("sha256").update(encKey).digest();
const payload = "v1:0DGQrm7mGlHwoREv:lpkO0yU/gjI735xnCJG0NQ==:clmYsuQs+AEaI1kOHCtpAw==";
const parts = payload.split(":");
const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64"));
decipher.setAuthTag(Buffer.from(parts[2], "base64"));
const plain = Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8");
console.log("CODE IN DOCKER:", authenticator.generate(plain));
'
