// seeds/roomSeed.js
const mongoose = require("mongoose");
const initData = require("./data.js");
const Room = require("../models/room.js");

// const MONGO_URL = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000&appName=mongosh+2.3.1";

main()
  .then(() => {
    console.log("Connected to DB");
  })
  .catch((err) => {
    console.log("DB connection error:", err);
  });

async function main() {
  await mongoose.connect(MONGO_URL);
}

const initDB = async () => {
  try {
    await Room.deleteMany({}); // Optional: Clears existing data
    await Room.insertMany(initData.data);
    console.log("Room data initialized successfully");
  } catch (err){
    console.log("Error initializing room data:", err);
  } finally {
    mongoose.connection.close(); // Close DB connection after seeding
  }
};

initDB();
