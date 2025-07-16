import "dotenv/config";
import WhatsAppWebJS from "whatsapp-web.js";
import QrCode from "qrcode";
import ExpressJS from "express";
import MySQL from "mysql2/promise";
import fs from "node:fs";
import { Server } from "socket.io";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { Client, LocalAuth } = WhatsAppWebJS;

const app = ExpressJS();
const port = process.env.APP_PORT;
const server = createServer(app);
const io = new Server(server);

app.use(ExpressJS.json());
app.use(ExpressJS.urlencoded({ extended: true }));

const __dirname = dirname(fileURLToPath(import.meta.url));

const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: CLIENT_ID,
    }),
    puppeteer: {
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--single-process",
            "--disable-gpu",
        ],
    },
});

const connection = async () => {
    return await MySQL.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
    });
};

const updateAck = async (from, ack) => {
    const db = await connection();
    const query = "UPDATE `wa_broadcasts` SET `ack` = ?, `updated_at` = NOW() WHERE `number` = ? AND `ack` < 9 AND `is_sent` > 0 AND `created_at` > SUBTIME(NOW(), '24:0:0')";
    await db.execute(query, [ack, from]);
    await db.end();
};

client.on("ready", () => {
    if (!fs.existsSync(`./${CLIENT_ID}.json`)) {
        fs.writeFile(`./${CLIENT_ID}.json`, JSON.stringify(client.info), function (err) {
            if (err) console.log(err);
        });
    }
    console.log("ready");
});

client.on("message", async (message) => {
    console.log(message);
});

client.on("message_ack", async (message) => {
    await updateAck(message.to, message.ack);
    console.log(message.to + " " + message.ack);
});

client.on("call", async (call) => {
    await call.reject();
});

client.on("auth_failure", (session) => {
    console.log(session);
});

client.on("authenticated", (session) => {
    console.log(session);
});

client.on("disconnected", (reason) => {
    if (fs.existsSync(`./${CLIENT_ID}.json`)) {
        fs.unlinkSync(`./${CLIENT_ID}.json`);
    }
    console.log(reason);
});

client.initialize();

io.on('connection', function (socket) {

    if (fs.existsSync(`./${CLIENT_ID}.json`)) {
        socket.emit('ready', 'Whatsapp is ready!');
    }

    client.on('qr', (qr) => {
        QrCode.toDataURL(qr, (err, url) => {
            console.log(err);
            socket.emit('qr', url);
        });
    });

    client.on('ready', () => {
        socket.emit('ready', 'Whatsapp is ready!');
    });

});

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
});

app.post('/send-text', async (req, res) => {
    const number = req.body.number;
    const message = req.body.message;
    const isRegistered = await client.isRegisteredUser(number);

    if (!isRegistered) {
        return res.status(404).json({
            status: false,
            ack: 9,
            message: 'Not registered'
        });
    }

    client.sendMessage(number, message).then(response => {
        res.status(200).json({
            status: true,
            ack: 0,
            message: 'Sent',
            response: response
        });
    }).catch(err => {
        res.status(500).json({
            status: false,
            ack: 0,
            message: 'Not sent',
            response: err
        });
    });
});

app.post('/request-pairing-code', async (req, res) => {
    const number = req.body.number;
    const response = await client.requestPairingCode(number);
    console.log(response);
    res.status(200).json({
        status: true,
        message: 'Success',
        response: response
    });
});

app.get('/logout', async (req, res) => {
    if (fs.existsSync(`./${CLIENT_ID}.json`)) {
        fs.unlinkSync(`./${CLIENT_ID}.json`);
    }
    client.logout();
    res.status(200).json({ status: true });
});

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
