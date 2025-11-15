const cron = require('node-cron');
const { ScheduledMessage } = require('./models');
/**
 * convert day+time -> cron expression
 * day: can be "monday" or "mon" or comma separated "mon,wed"
 * time: "HH:MM"
 * returns cron string like "0 30 14 * * MON" (seconds omitted since node-cron uses 5 fields)
 */

function buildCron(day, time) {
  const [hh, mm] = time.split(':').map(s => parseInt(s, 10));
  // node-cron uses: minute hour day month weekday
  // weekday: 0-6 or SUN-MON
  let weekDay = '*';
  if (day && day.trim()) {
    const mapping = { sun: 'SUN', mon: 'MON', tue: 'TUE', wed: 'WED', thu: 'THU', fri: 'FRI', sat: 'SAT',
                      sunday:'SUN', monday:'MON', tuesday:'TUE', wednesday:'WED', thursday:'THU', friday:'FRI', saturday:'SAT' };
    const parts = day.split(',').map(s => mapping[s.trim().toLowerCase()] || s.trim());
    weekDay = parts.join(',');
  }
  return `${mm} ${hh} * * ${weekDay}`;
}

const scheduledTasks = new Map();

async function scheduleExistingTasks(executor) {
  // executor is a function to execute message (e.g. save to db or trigger)
  const pending = await ScheduledMessage.find({ executed: false }).lean();
  for (const job of pending) {
    try {
      let cronExpr = job.cronExpr;
      if (!cronExpr) {
        cronExpr = buildCron(job.day, job.time);
        await ScheduledMessage.updateOne({ _id: job._id }, { $set: { cronExpr } });
      }
      const task = cron.schedule(cronExpr, async () => {
        await executor(job);
        await ScheduledMessage.updateOne({ _id: job._id }, { $set: { executed: true } });
        const t = scheduledTasks.get(String(job._id));
        if (t) t.stop();
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
