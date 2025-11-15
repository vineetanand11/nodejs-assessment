const mongoose = require('mongoose');
const {Schema} = mongoose;

//Agent
const AgentSchema = new Schema({
    name: { type: String, required: true, index: true },
}, { timestamps: true} );


// Account (User's Account)
const AccountSchema = new Schema({
    name : { type: String, required: true, index: true}
}, { timestamps: true });

// LOB (Policy Category)
const LOBSchema = new Schema({
    category_name: {type: String, required: false, index: true}
}, { timestamps: true });

// Carrier (company)
const CarrierSchema = new Schema({
    company_name: {type: String, required: false, index: true}
},{ timestamps: true});

//User
const UserSchema = new Schema({
    firstname : { type: String, required: true },
    dob: Date,
    address: String,
    phone: String,
    city: String,
    state: String,
    zip: String,
    email: { type: String, required: true },
    userType: String
}, { timestamps: true});


//Policy
const PolicySchema = new Schema({
    policy_number: { type: String, index:true },
    premium_amount_written: Number,
    premium_amount: Number,
    policy_type: String,
    policy_mode: String,
    policy_start_date: Date,
    policy_end_date: Date,
    producer: String,
    csr: String,
    agent: { type: Schema.Types.ObjectId, ref: 'Agent' },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    account: { type: Schema.Types.ObjectId, ref: 'Account' },
    lob: { type: Schema.Types.ObjectId, ref: 'LOB' },
    carrier: { type: Schema.Types.ObjectId, ref: 'Carrier' },
    /* category_name: String,
    company_name: String, */
    hasActiveClientPolicy: Boolean,
    applicantId: String,
    agency_id: String
}, { timestamps: true });

// Scheduled message
const ScheduledMessageSchema = new Schema({
    message: String,
    day: String,
    time: String,
    cronExpr: String,
    createdAt: { type: Date, default: Date.now() },
    executed: { type: Boolean, default: false }
});

module.exports = {
    Agent: mongoose.model('Agent', AgentSchema),
    Account: mongoose.model('Account', AccountSchema),
    LOB: mongoose.model('LOB', LOBSchema),
    Carrier: mongoose.model('Carrier', CarrierSchema),
    Policy: mongoose.model('Policy', PolicySchema),
    User: mongoose.model('User', UserSchema),
    ScheduledMessage: mongoose.model('ScheduledMessage', ScheduledMessageSchema)
}
