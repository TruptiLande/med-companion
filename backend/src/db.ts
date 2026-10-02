import { MongoClient, ObjectId } from "mongodb";
const client = new MongoClient(process.env.MONGO_URI ?? "mongodb://localhost:27017");
await client.connect();
export const db = client.db("medcompanion");
export const reminders = db.collection("reminders");
export const medications = db.collection("medications");
export const users = db.collection("users");
export { ObjectId };
