require('dotenv').config();
const express = require("express");
const mongoose = require('mongoose');
const path = require("path");
const methodOverride = require("method-override");
const session = require('express-session');
const MongoStore = require('connect-mongo'); // FIXED: Removed (session) call
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const port = process.env.PORT || 8080;
const dbUrl = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/test";

const app = express();

// --- Database Connection ---
async function main() {
    await mongoose.connect(dbUrl);
    console.log("Database connection successful");
}
main().catch((err) => console.log(err));

// --- Schemas & Models ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true } // Note: Hash passwords with bcrypt in production!
});
const User = mongoose.model("User", userSchema);

const LogSchema = new mongoose.Schema({
    inputText: String,
    aiOutput: String,
    responseTimeMs: Number, 
    createdAt: { type: Date, default: Date.now }
});

const promptSchema = new mongoose.Schema({
    title: String, 
    templateText: String,
    version: String,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    logs: [LogSchema]
});
const Prompt = mongoose.model("Prompt", promptSchema);

// --- Middleware Setup ---
app.use(express.urlencoded({ extended: true })); 
app.use(methodOverride("_method")); 
app.set("view engine", "ejs"); 
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// --- Express Session Configuration with MongoDB Store ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'secretkey',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: dbUrl,
        collectionName: 'sessions'
    }),
    cookie: {
        secure: false, // Keep false for standard HTTP/localhost. Set to true if running on live HTTPS.
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // Session active for 1 day
    }
}));

// --- Routes ---

app.get("/", (req, res) => {
    res.redirect("/prompts");
});

// Authentication Routes
app.get("/login", (req, res) => {
    res.render("login.ejs");
});

app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });

    if (!user) {
        return res.status(400).send("Invalid username or password");
    }

    req.session.userId = user._id; 
    req.session.save((err) => {
        if (err) {
            console.error("Session save error:", err);
            return res.status(500).send("Login failed.");
        }
        res.redirect("/prompts");
    });
});

app.get("/signup", (req, res) => {
    res.render("signup.ejs");
});

app.post("/signup", async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).send("Username already taken");
        }

        const newUser = await User.create({ username, password });
        req.session.userId = newUser._id;
        req.session.save((err) => {
            if (err) {
                console.error("Session save error:", err);
                return res.status(500).send("Signup failed.");
            }
            res.redirect("/prompts");
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error creating user");
    }
});

app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error("Logout error:", err);
        res.redirect("/login");
    });
});

// Protected Prompts Routes
app.get('/prompts', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.redirect('/login');
        }

        const prompts = await Prompt.find({ userId: req.session.userId }); 
        res.render('index.ejs', { prompts });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

app.get('/prompts/new', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.render('new.ejs');
});

app.post('/prompts', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { title, templateText, version } = req.body;
    await Prompt.create({ 
        title, 
        templateText, 
        version, 
        userId: req.session.userId 
    });
    res.redirect('/prompts');
});

app.get('/prompts/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const prompt = await Prompt.findById(req.params.id);
    res.render('show.ejs', { prompt });
});

app.post('/prompts/:id/test', async (req, res) => {
    try {
        if (!req.session.userId) return res.redirect('/login');
        const { inputText } = req.body;
        const prompt = await Prompt.findById(req.params.id);
        const startTime = Date.now();

        const fullPrompt = `System Instructions: ${prompt.templateText}\n\nUser Input: ${inputText}`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: fullPrompt }],
            model: 'llama-3.3-70b-versatile',
        });

        const realAiOutput = chatCompletion.choices[0]?.message?.content || "";
        const responseTimeMs = Date.now() - startTime;

        prompt.logs.push({
            inputText, 
            aiOutput: realAiOutput,
            responseTimeMs
        });

        await prompt.save();
        res.redirect(`/prompts/${prompt._id}`);

    } catch (err) {
        console.error("AI Error:", err);
        res.status(500).send("Something went wrong generating the AI response.");
    }
});

app.listen(port, () => {
    console.log(`PromptHub running on port ${port}`);
});