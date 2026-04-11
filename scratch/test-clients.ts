import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const googleApiKey = process.env.GOOGLE_AI_API_KEY;
const openRouterApiKey = process.env.OPENROUTER_API_KEY;

console.log("GOOGLE_AI_API_KEY present:", !!googleApiKey);
console.log("OPENROUTER_API_KEY present:", !!openRouterApiKey);

const googleClient = googleApiKey ? new OpenAI({
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  apiKey: googleApiKey,
}) : null;

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: openRouterApiKey || "dummy",
});

const targetClient = googleClient || client;
const targetModel = googleClient ? "gemini-2.0-flash" : "google/gemini-2.0-flash-001";

console.log("Using client:", googleClient ? "Google" : "OpenRouter");
console.log("Using model:", targetModel);
console.log("Base URL:", targetClient.baseURL);
