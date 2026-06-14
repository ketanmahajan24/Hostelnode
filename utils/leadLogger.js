// utils/leadLogger.js
async function createLead({ req, leadType, hostelId, hostelName, moveIn, message }) {
  console.log('📋 Lead logged:', { leadType, hostelId, hostelName, moveIn });
  // TODO: save to DB later
}
module.exports = { createLead };