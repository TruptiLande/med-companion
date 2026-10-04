import { Agent } from "@mastra/core/agent";
import { createOllama } from "ollama-ai-provider-v2";
import { getMedicationsTool, getReminderStatusTool, setLanguageTool } from "../tools/medication-tools.js";

const ollama = createOllama({
  baseURL: `${process.env.OLLAMA_URL ?? "http://localhost:11434"}/api`,
});

export const medAgent = new Agent({
  id: "medication-agent",
  name: "Medication Assistant",
  instructions:
    "You help older adults and their families with an already-confirmed medication schedule. Answer in the user's language. Never prescribe, change doses or give clinical advice; refer those questions to a doctor or pharmacist.",
  model: ollama(process.env.GEMMA_MODEL ?? "gemma3:4b"),
  tools: { setLanguage: setLanguageTool, getMeds: getMedicationsTool, getStatus: getReminderStatusTool },
});
