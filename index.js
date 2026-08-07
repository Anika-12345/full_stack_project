require('dotenv').config();
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const express = require("express");
const mongoose = require('mongoose');




const app= express();
const port=8080;
const path= require("path");
const methodOverride= require("method-override");



main()
    .then(()=>{
    console.log("connnection successful")
    })
    .catch((err) => console.log(err));

async function main(){
    const dbUrl = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/test";
    await mongoose.connect(dbUrl);
}

app.use(express.urlencoded({extended:true})); 
app.use(methodOverride("_method")); 
app.set("view engine", "ejs"); 
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));



const LogSchema = new mongoose.Schema({
    inputText: String,
    aiOutput: String,
    responseTimeMs: Number, 
    createdAt: {type: Date, default:Date.now}
});

const promptSchema = new mongoose.Schema({
    title: String, 
    templateText: String,
    version: String,
    logs: [LogSchema]
});

const Prompt= mongoose.model("Prompt", promptSchema);


//routes
app.get('/prompts', async (req, res)=>{
    const prompts = await Prompt.find({}); 
    res.render('index.ejs', {prompts});
})
app.get('/prompts/new', (req, res) => {
    res.render('new.ejs');
});
app.post('/prompts', async (req, res) => {
    const { title, templateText, version} = req.body;
    await Prompt.create({ title, templateText, version });
    res.redirect('/prompts');
});
app.get('/prompts/:id', async (req, res) => {
    const prompt = await Prompt.findById(req.params.id);
    res.render('show.ejs', { prompt });
});



app.post('/prompts/:id/test', async (req, res) => {
    try {
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
    console.log(`PromptHub running on http://localhost:${port}`);
});