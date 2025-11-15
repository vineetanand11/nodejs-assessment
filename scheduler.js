require('dotenv').config();
const cron = require('node-cron');
const { ScheduledMessage } = require('./models');

const TIMEZONE = process.env.TZ || "Asia/Kolkata";

/**
 * convert day+time -> cron expression
 * day: can be "monday" or "mon" or comma separated "mon,wed"
 * time: "HH:MM"
 * returns cron string like "0 30 14 * * MON" (seconds omitted since node-cron uses 5 fields)
 */

function buildCron(day, time) {
  if (!day || !time) {
    throw new Error("day and time are required");
  }

  // Time: HH:mm
  const [hour, minute] = time.split(":");
  // Day: YYYY-MM-DD
  const [year, month, date] = day.split("-");

  if (!hour || !minute || !year || !month || !date) {
    throw new Error("Invalid day or time format");
  }

  // Cron format: second minute hour day month weekday
  // We run cron in Asia/Kolkata timezone, so NO UTC CONVERSION.
  return `0 ${minute} ${hour} ${parseInt(date)} ${parseInt(month)} *`;
}


const scheduledTasks = new Map();

async function scheduleExistingTasks(executor) {
  console.log("scheduleExistingTasks called");

  const pending = await ScheduledMessage.find({ executed: false }).lean();
  console.log("Found pending jobs:", pending.length);
 
  for (const job of pending) {
    try {
      console.log("Scheduling Job:", job._id, job.cronExpr || `${job.day} ${job.time}`);
     

      let cronExpr = job.cronExpr;
      if (!cronExpr) {
        cronExpr = buildCron(job.day, job.time);
        console.log("Generated cron:", cronExpr);
        await ScheduledMessage.updateOne({ _id: job._id }, { $set: { cronExpr } });
      }

     const task = cron.schedule(cronExpr, async () => {
        console.log("JOB EXECUTED:", job._id);
        await executor(job);
        await ScheduledMessage.updateOne({ _id: job._id }, { $set: { executed: true } });

        const t = scheduledTasks.get(String(job._id));
        if (t) t.stop();
      }, {
        timezone: TIMEZONE
      });


      scheduledTasks.set(String(job._id), task);

    } catch (e) {
      console.error('Failed to schedule job', job._id, e.message);
    }
  }
}


function scheduleNew(jobDoc, executor) {
  const cronExpr = jobDoc.cronExpr || buildCron(jobDoc.day, jobDoc.time);
  const task = cron.schedule(cronExpr, async () => {
    await executor(jobDoc);
    await ScheduledMessage.updateOne({ _id: jobDoc._id }, { $set: { executed: true } });
    const t = scheduledTasks.get(String(jobDoc._id));
    if (t) t.stop();
  });
  scheduledTasks.set(String(jobDoc._id), task);
}

module.exports = {
  scheduleExistingTasks,
  scheduleNew,
  buildCron
};
