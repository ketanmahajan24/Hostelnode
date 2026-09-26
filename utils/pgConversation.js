// ============================================================
//  utils/pgConversation.js — HostelNode PG/Hostel chat
//  NEW FILE — Phase 7 of the PG/Hostel chat feature.
// ============================================================
/* ============================================================
   findOrCreatePgConversation() — the exact same find-or-create
   logic that routes/messagesRoutes.js's POST /pg/start has used
   since Phase 2, pulled out into its own module so a second call
   site (routes/studentRoutes.js's POST /student/contact-owner,
   added in Phase 7) can reuse it instead of re-implementing it and
   risking the two definitions drifting apart later.

   POST /pg/start itself is NOT changed to call this — it already
   works, and there's no reason to touch a route that isn't broken
   just to remove a few duplicated lines. Only the new Phase 7 call
   site uses this file.
============================================================ */

const Conversation = require("../models/Conversation");

/**
 * findOrCreatePgConversation(studentId, listingId, ownerId)
 *
 * One conversation per (student, listing) — scoped by listing, not
 * by owner alone, identical reasoning to POST /pg/start's own
 * comment on this point.
 *
 * Returns the Conversation document (a real Mongoose doc, not
 * .lean() — callers may need to .save() it, e.g. to bump
 * lastMessage/unreadCounts after posting a message into it).
 */
async function findOrCreatePgConversation(studentId, listingId, ownerId) {
  let conversation = await Conversation.findOne({
    type: "PG_INQUIRY",
    listing: listingId,
    participants: studentId,
  });

  if (!conversation) {
    conversation = await Conversation.create({
      type: "PG_INQUIRY",
      participants: [studentId],
      ownerParticipant: ownerId,
      listing: listingId,
      listingModel: "Listing",
      status: "active",
    });
  }

  return conversation;
}

module.exports = { findOrCreatePgConversation };
