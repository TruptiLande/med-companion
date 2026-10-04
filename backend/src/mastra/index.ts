import { Mastra } from "@mastra/core";
import { medAgent } from "./agents/medication-agent.js";

export const mastra = new Mastra({
  agents: { "medication-agent": medAgent },
});

export { medAgent };
