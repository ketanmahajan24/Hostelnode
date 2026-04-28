// utils/updateFloorData.js
const Floor = require("../models/floor");
const Room = require("../models/room");

async function updateFloorData(floorId) {
  const rooms = await Room.find({ floor_id: floorId });

  const total_rooms = rooms.length;
  const occupied_rooms = rooms.filter(room => room.occupied_beds > 0).length;
  const total_beds = rooms.reduce((sum, room) => sum + room.sharing_capacity, 0);
  const occupied_beds = rooms.reduce((sum, room) => sum + room.occupied_beds, 0);

  await Floor.findByIdAndUpdate(floorId, {
    total_rooms,
    occupied_rooms,
    total_beds,
    occupied_beds,
  });
}

module.exports = updateFloorData;
