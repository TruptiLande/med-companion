import { Worker, NativeConnection } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import * as activities from "./activities.js";
const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" });
const worker = await Worker.create({ connection, taskQueue: "meds", workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)), activities });
console.log("Temporal worker running");
await worker.run();
