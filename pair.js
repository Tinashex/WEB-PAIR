const express = require('express');
const fs = require('fs');
const { exec } = require("child_process");
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser
} = require("@whiskeysockets/baileys");
const { upload } = require('./mega');

const router = express.Router();

function removeFile(filePath) {
    if (!fs.existsSync(filePath)) return false;
    fs.rmSync(filePath, { recursive: true, force: true });
}

async function randomMegaId(length = 6, numberLength = 4) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const number = Math.floor(Math.random() * Math.pow(10, numberLength));
    return `${result}${number}`;
}

router.get('/', async (req, res) => {
    const numRaw = req.query.number;
    if (!numRaw) return res.status(400).send({ error: "Missing number query parameter" });

    const num = numRaw.replace(/[^0-9]/g, '');

    async function PrabathPair() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState('./session');

            const socket = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            socket.ev.on('creds.update', saveCreds);

            socket.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
                if (connection === "open") {
                    try {
                        await delay(5000);

                        const credsPath = './session/creds.json';
                        if (!fs.existsSync(credsPath)) throw new Error("Session file missing");

                        const megaFileName = await randomMegaId() + '.json';
                        const megaUrl = await upload(fs.createReadStream(credsPath), megaFileName);
                        const sid = megaUrl.replace('https://mega.nz/file/', '');
                        const userJid = jidNormalizedUser(socket.user.id);

                        await socket.sendMessage(userJid, { text: sid });
                        removeFile('./session'); // Clean up session folder

                        console.log("Pairing complete. Session uploaded.");
                        if (!res.headersSent) res.send({ code: sid });

                    } catch (err) {
                        console.error("Error sending session:", err);
                        exec('pm2 restart prabath');
                        if (!res.headersSent) res.send({ code: "Failed to upload session" });
                    }

                } else if (connection === "close" && lastDisconnect && lastDisconnect.error?.output?.statusCode !== 401) {
                    console.log("Connection closed. Retrying...");
                    await delay(10000);
                    PrabathPair();
                }
            });

            if (!socket.authState.creds.registered) {
                if (!res.headersSent) res.send({ code: "Session not registered. Use an existing session first." });
            } else {
                if (!res.headersSent) res.send({ code: "Session already exists." });
            }

        } catch (err) {
            console.error("Pairing service error:", err);
            exec('pm2 restart prabath');
            removeFile('./session');
            if (!res.headersSent) res.send({ code: "Service Unavailable" });
        }
    }

    await PrabathPair();
});

process.on('uncaughtException', (err) => {
    console.error('Caught exception:', err);
    exec('pm2 restart prabath');
});

module.exports = router;
