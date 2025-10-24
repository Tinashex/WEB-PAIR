const express = require('express');
const fs = require('fs');
const { exec } = require("child_process");
const pino = require("pino");
const { default: makeWASocket, jidNormalizedUser, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys");
const { upload } = require('./mega');

let router = express.Router();

// Remove file or folder
function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

// Random mega filename
function randomMegaId(length = 6, numberLength = 4) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const number = Math.floor(Math.random() * Math.pow(10, numberLength));
    return `${result}${number}`;
}

router.get('/', async (req, res) => {
    const numRaw = req.query.number;
    if (!numRaw) return res.status(400).send({ error: "Missing number query parameter" });
    const num = numRaw.replace(/[^0-9]/g, '');
    const sessionFolder = `./sessions/${num}`; // Separate folder per number

    try {
        if (!fs.existsSync(`${sessionFolder}/creds.json`)) {
            return res.send({ code: "❌ No existing session. Please scan a QR code once to create session." });
        }

        // Load existing session
        const state = JSON.parse(fs.readFileSync(`${sessionFolder}/state.json`));
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: ['Web Pair', 'Chrome', '1.0']
        });

        // Upload creds.json to Mega and return link
        const credsPath = `${sessionFolder}/creds.json`;
        const megaFileName = `${randomMegaId()}.json`;
        const megaUrl = await upload(fs.createReadStream(credsPath), megaFileName);

        const sid = megaUrl.replace('https://mega.nz/file/', '');
        res.send({ code: sid });

    } catch (err) {
        console.error("Pairing error:", err);
        exec('pm2 restart prabath'); // restart service if needed
        removeFile(sessionFolder);
        res.send({ code: "❌ Service Unavailable" });
    }
});

module.exports = router;
