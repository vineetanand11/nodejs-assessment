const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const mongoose = require('mongoose');
const { Agent, User, Account, LOB, Policy, Carrier} = require('./models');

async function connectDb(uri) {
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    }
}

function parseCSV(filePath)
{
    return new Promise((resolve, reject) => {
        const rows = [];
        fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => rows.push(data))
        .on('end', () => resolve(rows))
        .on('error', (err) => reject(err));
    });
}

function parseXLSX(filePath)
{
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames[0];   // get first sheet name
    const sheet = wb.Sheets[sheetName];    // correct: wb.Sheets
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    return rows;
}

async function findOrCreate(model, query, createData = {} ) {
    const existing = await model.findOne(query).lean();
    if (existing) {
        return existing;
    }
    const doc = await model.create({ ...query, ...createData });
    return doc.toObject();
}

function toDateSafe(val)
{
    if (!val) return null;
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d;
}

(async () => {
    try {
        const  { filePath, MONGODB_URI } = workerData;
        await connectDb(MONGODB_URI);

        let rows;
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.csv') {
            rows = await parseCSV(filePath);
        } else {
            rows = parseXLSX(filePath);
        }

        const total = rows.length;
        let done = 0;

        for (const row of rows) {
            // Normalizing column names: match the user's CSV columns.
            // Provided columns: agent, userType, policy_mode, producer,policy_number,premium_amount_written,premium_amount,policy_type,company_name,category_name,policy_start_date,policy_end_date,csr,account_name,email,gender,firstname,city,account_type,phone,address,state,zip,dob,primary,Applicant ID,agency_id,hasActive ClientPolicy
            
            //Agent
            const agentName = (row.agent || row.Agent || '').trim();
            const agent = agentName ? await findOrCreate(Agent, { name: agentName }) : null;

            //Account
            const accountName = (row.account_name || row.accountName || row['account name'] || '').trim();
            const account =  accountName ? await findOrCreate(Account, { name: accountName }) : null;

            //LOB
            const lobName = (row.category_name || row.category || '').trim();
            const lob = lobName ? await findOrCreate(LOB, { category_name: lobName }) : null;

            // Carrier
            const carrierName = (row.company_name || row.company || '').trim();
            const carrier =  carrierName ? await findOrCreate(Carrier, { company_name: carrierName }) : null;

            //User
            const firstname = (row.firstname || row.firstName || '').trim();
            const email = (row.email || '').trim();
            const dob = toDateSafe(row.dob);
            const userQuery = {
                firstname,
                email
            };

            // Create user if not exists
            let user = await User.findOne(userQuery).lean();
            if (!user) {
                const newUser = await User.create({
                    firstname,
                    email,
                    dob,
                    address: row.address || '',
                    phone: row.phone || '',
                    state: row.state || '',
                    city: row.city || '',
                    zip: row.zip || '',
                    userType: row.userType || '',
                    account: account ? account._id : null
                });

                user = newUser.toObject();
            }

            //Policy
            const policyObj = {
                policy_number: (row.policy_number || row.PolicyNumber || '').toString(),
                premium_amount_written: Number(row.premium_amount_written || 0),
                premium_amount: Number(row.premium_amount || 0),
                policy_type: row.policy_type || '',
                policy_mode: row.policy_mode || '',
                policy_start_date: toDateSafe(row.policy_start_date),
                policy_end_date: toDateSafe(row.policy_end_date),
                producer: row.producer || '',
                csr: row.csr || '',
                agent: agent ? agent._id : null,
                user: user ? user._id : null,
                account: account ? account._id : null,
                lob: lob ? lob._id : null,
                carrier: carrier ? carrier._id : null,
               /*  category_name: lobName,
                company_name: carrierName, */
                hasActiveClientPolicy: (String(row['hasActive ClientPolicy'] || row.hasActiveClientPolicy || '').toLowerCase() === 'true'),
                applicantId: row['Applicant ID'] || row['ApplicantID'] || '',
                agency_id: row.agency_id || row['agency id'] || ''
            };

            await Policy.create(policyObj);

            done++;

            if (done % 50 === 0 || done === total) {
                parentPort.postMessage({ progress: Math.round((done / total) * 100), done, total });
            }

        }

        parentPort.postMessage({ done: true, total });
        process.exit(0);

    } catch(err) {
        parentPort.postMessage({ error: err.message });
        process.exit(1);
    }
})();
