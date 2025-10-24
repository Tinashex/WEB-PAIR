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

let router = express.Router();

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

async function randomMegaId(length = 6, numberLength = 4) {
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

    async function PrabathPair() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(`./session`);

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

            socket.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === "open") {
                    try {
                        await delay(5000);

                        const authPath = './session/';
                        const credsPath = authPath + 'creds.json';
                        if (!fs.existsSync(credsPath)) throw new Error("Session file missing");

                        const megaFileName = await randomMegaId() + '.json';
                        const megaUrl = await upload(fs.createReadStream(credsPath), megaFileName);
                        const sid = megaUrl.replace('https://mega.nz/file/', '');
                        const userJid = jidNormalizedUser(socket.user.id);

                        await socket.sendMessage(userJid, { text: sid });

                        removeFile(authPath); // Clean up session folder
                        console.log("Pairing complete and session uploaded.");

                    } catch (err) {
                        console.error("Error sending session to user:", err);
                        exec('pm2 restart prabath');
                    }

                } else if (connection === "close") {
                    if (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output?.statusCode !== 401) {
                        console.log("Connection closed, retrying...");
                        await delay(10000);
                        PrabathPair();
                    }
                }
            });

            if (!socket.authState.creds.registered) {
                // Since requestPairingCode is unreliable, we just return a message
                if (!res.headersSent) res.send({ code: "Session not yet registered. Use a QR session first." });
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

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ' + err);
    exec('pm2 restart prabath');
});

module.exports = router;
