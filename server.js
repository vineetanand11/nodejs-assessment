require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { v4: uuidv4 } = require('uuid');
const { Agent, Account, LOB, Carrier, User, Policy, ScheduledMessage } = require('./models');
const { scheduleExistingTasks, scheduleNew, buildCron } = require('./scheduler');


const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/insurance-assessment';
const PORT = process.env.PORT || 4000;

async function connectDb() {
    await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
}

connectDb().then(() => console.log('Mongo connected')).catch(console.error);

const app = express();
app.use(express.json());

// FILE UPLOAD SETUP
const upload = multer({ dest: 'tmp/' });

/**
 * POST /upload
 * multipart/form-data with file field "file" (csv or xlsx)
 * uses worker threads to parse & insert
 */
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file (csv/xlsx) is required' });

    const filePath = path.resolve(req.file.path);
    const jobId = uuidv4();

    // Notify parent (monitor) that import is starting.
    // This must be sent BEFORE worker starts to avoid race.
    try {
        if (process.send) process.send({ type: 'IMPORT_STARTED', jobId });
    } catch (e) {
        console.warn('process.send failed (likely not forked):', e && e.message);
    }

    const worker = new Worker(path.resolve(__dirname, 'worker-parse.js'), {
        workerData: { filePath, MONGODB_URI }
    });

    // track if we've told parent the import finished (avoid duplicate sends)
    let finishedNotified = false;
    function notifyFinished(errFlag = false) {
        if (finishedNotified) return;
        finishedNotified = true;
        try {
            if (process.send) process.send({ type: 'IMPORT_FINISHED', jobId, error: !!errFlag });
        } catch (e) {
            console.warn('process.send failed (IMPORT_FINISHED):', e && e.message);
        }
    }

    worker.on('message', (msg) => {
        console.log('Worker message:', msg);
        // if worker signals done explicitly
        if (msg.done === true) {
            notifyFinished(false);
        }
        // optionally handle progress messages...
    });

    worker.on('error', (err) => {
        console.error('Worker error', err);
        notifyFinished(true);
    });

    worker.on('exit', (code) => {
        console.log('Worker exited code', code);
        // ensure parent gets IMPORT_FINISHED even if worker didn't send done message
        notifyFinished(code !== 0);
    });

    // respond immediately to client
    res.json({ jobId, message: 'Upload accepted and processing started.' });
});


/**
 * GET /policy/search?username=firstname
 * Find policy info by username (firstname). returns policies + populated references
 */
app.get('/policy/search', async (req, res) => {
    const username = req.query.username;
    if (!username) {
        return res.status(400).json({ error: 'username query param required' });
    }

    const user = await User.findOne({ firstname: username }).lean();
    if (!user)  return res.status(404).json({ error: 'user not found!'}); 

    const policies = await Policy.find({ user: user._id })
        .populate('agent', 'name')
        .populate('account', 'name')
        .populate('lob', 'name')
        .populate('carrier', 'name')
        .lean();

    res.json({ user, policies });
});


/**
 * GET /policies/aggregate
 * aggregated policy by each user (count, sum premium)
 */
app.get('/policies/aggregate', async (req, res) => {
    try {
        const result = await Policy.aggregate([
        {
            $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "user_details"
            }
        },
        { $unwind: "$user_details" },

        {
            $group: {
            _id: "$user_details._id",
            user: { $first: "$user_details.firstname" },
            email: { $first: "$user_details.email" },
            totalPolicies: { $sum: 1 },
            totalPremium: { $sum: "$premium_amount" }
            }
        }
        ]);

        res.json(result);

    } catch (err) {
        console.error("Aggregate ERROR:", err);
        res.status(500).json({ error: err.message });
    }
});


/**
 * POST /schedule
 * { message, day, time }
 * day: single day or comma separated (mon,tue) or full day names
 * time: "HH:MM" 24-hour format
 */
app.post('/schedule', async (req, res) => {
    const { message, day, time } = req.body;
    if (!message || !day || !time) return res.status(400).json({ error: 'message, day, time required' });

    // build cron expr for storage
    const cronExpr = buildCron(day, time);
    const job = await ScheduledMessage.create({ message, day, time, cronExpr });
    // schedule it
    scheduleNew(job, async (jobDoc) => {
        console.log('Executing scheduled message:', jobDoc.message, new Date().toISOString());
        // You can insert into DB or send to some service. For now we just log and mark executed
        // If desired, create an "ExecutedMessages" collection or do other actions.
    });

    res.json({ jobId: job._id, cronExpr, message: 'Scheduled' });
});


/**
 * GET /schedules
 */
app.get('/schedules', async (req, res) => {
  const list = await ScheduledMessage.find().lean();
  res.json(list);
});


/**
 * (Optional) endpoint to fetch policies by policy number
 */
app.get('/policies/:policyNumber', async (req, res) => {
    const { policyNumber } = req.params;
    if (!policyNumber) {
        return res.status(400).json({ error: "policy number missing" });
    }
    const policy = await Policy.findOne({ policy_number:policyNumber })
        .populate('agent account lob carrier user')
        .lean();
    if (!policy) return res.status(404).json({ error: 'policy not found' });
    res.json(policy);
});

/**
 * health
 */
app.get('/health', (req, res) => res.json({ ok: true, pid: process.pid }));

// start scheduling existing stored messages
scheduleExistingTasks(async (jobDoc) => {
  console.log('Executing scheduled job from DB:', jobDoc.message, new Date().toISOString());
  // mark executed is handled by scheduler.js after executor completes
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT} (pid ${process.pid})`);
});
