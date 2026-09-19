// ================= messagesRoutes.js =============================
/* ============================================================
   messagesRoutes.js — HostelNode universal Messages
   ONE inbox for both Flatmate connection requests/chat and (future)
   PG/Hostel enquiry chat — per the "no separate Requests page, no
   separate Flatmate-only chat" architecture principle. This file
   does NOT touch the existing PG enquiry flow (routes/userRoutes.js,
   models/enquiry.js) — PG conversations will start flowing into this
   same inbox once that integration is wired up separately, without
   any change needed here.

   - GET  /messages                          → inbox (All / PG & Hostel / Flatmate)
   - GET  /messages/:conversationId           → chat thread
   - POST /messages/:conversationId/messages  → send a message
   - POST /messages/connection/:id/accept     → accept a pending request
   - POST /messages/connection/:id/decline    → decline a pending request
   - POST /messages/connection/:id/remove     → end an accepted connection

   (Cancelling your own outgoing pending request already lives at
   POST /flatmate/connection/:id/cancel — built in Phase 3 — reused
   as-is from the inbox UI rather than duplicated here.)
============================================================ */

const express = require("express");
const router  = express.Router();
const jwt     = require("jsonwebtoken");

const FlatmateConnection = require("../models/FlatmateConnection");
const Conversation       = require("../models/Conversation");
const Message            = require("../models/Message");
const Block              = require("../models/Block");
const Report             = require("../models/Report");
const Student            = require("../models/studentSchema");
const FlatmateListing    = require("../models/FlatmateListing");
const { notifyFlatmateEvent } = require("../utils/flatmateNotifications");

/* ── Auth — same contract as flatmateRoutes.js's requireStudent, defined
   locally so this file has no cross-file coupling. ── */
function requireStudent(req, res, next) {
  const token = req.cookies?.studentToken;
  if (!token) return res.redirect(`/student/login?next=${encodeURIComponent(req.originalUrl)}`);
  try {
    req.student = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    res.clearCookie("studentToken");
    return res.redirect(`/student/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
}

function listingSummary(listing, listingModel) {
  if (!listing) return "Listing no longer available";
  if (listingModel === "FlatmateListing") {
    return `${listing.bhk} BHK · ${listing.roomType || ""} · ${listing.area}, ${listing.city}`;
  }
  return listing.title || "PG / Hostel listing";
}

function getUnread(conv, viewerId) {
  if (!conv.unreadCounts) return 0;
  // .lean() docs give a plain object, non-lean give a Map — handle both.
  if (typeof conv.unreadCounts.get === "function") return conv.unreadCounts.get(viewerId) || 0;
  return conv.unreadCounts[viewerId] || 0;
}

/* ── Suggested opening messages ─────────────────────────────────
   Shown as tappable chips on a new/near-empty Flatmate chat, so
   people aren't staring at a blank box. Two fixed sets — "seeker"
   (the person who sent the connection request) and "lister" (the
   listing owner who received it) — since the useful opening lines
   are genuinely different for each side. Tapping a chip fills the
   input box (never auto-sends), so the person can edit it — these
   are prompts, not claims HostelNode is making on anyone's behalf.
──────────────────────────────────────────────────────────────── */
const SEEKER_SUGGESTIONS = [
  "Hi! I'm still looking for a flatmate — is the room still available?",
  "What's the exact move-in date you're looking at?",
  "Is the rent negotiable, and what's included (wifi, maintenance, etc.)?",
  "Could you share a few more photos of the room and common areas?",
  "What's the vibe like — similar schedules, food preferences, etc.?",
  "Is the deposit refundable, and how much notice is needed to move out?",
  "Would it be possible to see the place in person this week?",
  "Are pets allowed in the flat?",
  "How far is it from the nearest metro/bus stop?",
  "Just to confirm — is this a shared room or an independent room?",
];
const LISTER_SUGGESTIONS = [
  "Hi! Thanks for reaching out — yes, the room is still available.",
  "When are you looking to move in?",
  "A bit about you — are you a student or a working professional?",
  "Do you have any specific requirements (veg/non-veg, pets, smoking, etc.)?",
  "I can show you around — are you free this week for a visit?",
  "Let me know your budget and I'll confirm if it works.",
  "Feel free to ask me anything about the flat or the area!",
  "How many flatmates are you looking to move in with?",
  "Let me know if you'd like more details about the amenities.",
  "Would you like to do a video call first before visiting in person?",
];

/* ─────────────────────────────────────────────
   INBOX  →  GET /messages
───────────────────────────────────────────── */
router.get("/", requireStudent, async (req, res) => {
  try {
    const viewerId = req.student.id;

    // Pending connections (both directions) — shown as "request" rows.
    // Accepted ones are represented via their Conversation instead, so
    // they aren't shown twice.
    const connections = await FlatmateConnection.find({
      $or: [{ requester: viewerId }, { receiver: viewerId }],
      status: "pending",
    })
      .populate("requester", "firstName")
      .populate("receiver", "firstName")
      .populate("receiverListing")
      .sort({ updatedAt: -1 })
      .lean();

    const conversations = await Conversation.find({ participants: viewerId })
      .populate("participants", "firstName")
      .populate("listing")
      .sort({ updatedAt: -1 })
      .lean();

    const rows = [];

    connections.forEach((conn) => {
      const incoming = conn.receiver?._id?.toString() === viewerId;
      rows.push({
        kind: "request",
        category: "flatmate",
        incoming,
        connectionId: conn._id.toString(),
        counterpartName: (incoming ? conn.requester?.firstName : conn.receiver?.firstName) || "HostelNode User",
        listingText: listingSummary(conn.receiverListing, "FlatmateListing"),
        message: conn.message || "",
        updatedAt: conn.updatedAt,
      });
    });

    conversations.forEach((conv) => {
      const counterpart = (conv.participants || []).find((p) => p._id.toString() !== viewerId);
      rows.push({
        kind: "chat",
        category: conv.type === "PG_INQUIRY" ? "pg" : "flatmate",
        conversationId: conv._id.toString(),
        counterpartName: counterpart?.firstName || "HostelNode User",
        listingText: listingSummary(conv.listing, conv.listingModel),
        status: conv.status,
        lastMessage: conv.lastMessage || "",
        unread: getUnread(conv, viewerId),
        updatedAt: conv.updatedAt,
      });
    });

    rows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.render("messages/messages", { rows });
  } catch (err) {
    console.error("Messages inbox error:", err);
    res.status(500).send("Something went wrong loading your messages. Please try again.");
  }
});

/* ─────────────────────────────────────────────
   ACCEPT  →  POST /messages/connection/:id/accept
   Only the receiver can accept. Creates (or reuses) the Conversation.
───────────────────────────────────────────── */
router.post("/connection/:id/accept", requireStudent, async (req, res) => {
  try {
    const connection = await FlatmateConnection.findById(req.params.id);
    if (!connection || connection.receiver.toString() !== req.student.id || connection.status !== "pending") {
      return res.json({ success: false, error: "Request not found or already handled." });
    }

    connection.status = "accepted";
    connection.acceptedAt = new Date();
    await connection.save();

    let conversation = await Conversation.findOne({ connection: connection._id });
    if (!conversation) {
      conversation = await Conversation.create({
        type: "FLATMATE_CONNECTION",
        participants: [connection.requester, connection.receiver],
        listing: connection.receiverListing,
        listingModel: "FlatmateListing",
        connection: connection._id,
        status: "active",
      });

      // The requester's original "Request to Connect" message was, until
      // now, only ever stored on the FlatmateConnection itself — it never
      // became a real Message, so it silently vanished once the chat
      // opened (issue: request message never appears in the conversation).
      // Carry it over as this conversation's first message, exactly once
      // (only in this "conversation didn't exist yet" branch, never on a
      // re-fetch), so the requester's "Hi, I'm interested..." shows up as
      // a normal chat bubble instead of being lost. Stamped with the
      // ORIGINAL request time (connection.createdAt), not the moment of
      // acceptance, so the timeline reads correctly (they wrote it then,
      // not just now).
      const requestText = (connection.message || "").trim();
      if (requestText) {
        const firstMessage = new Message({
          conversation: conversation._id,
          sender: connection.requester,
          text: requestText,
          createdAt: connection.createdAt,
        });
        await firstMessage.save();

        conversation.lastMessage = requestText.slice(0, 140);
        conversation.lastMessageAt = connection.createdAt;
        // Not counted as unread for the receiver — they already read this
        // exact text on the request they just chose to accept, so a "1
        // unread" badge the instant the conversation opens would be
        // misleading rather than helpful.
        await conversation.save();
      }
    }

    // Centralized lifecycle notification — in-app + WhatsApp to the
    // requester. Fires exactly once, only on this actual
    // pending->accepted transition (the guard at the top of this route
    // already prevents a second accept call from reaching this code at
    // all) — dedupeKey is a backstop, not the only guard. Non-critical:
    // acceptance has already been fully saved above regardless of
    // whether this notification succeeds.
    (async () => {
      const [requesterDoc, receiverDoc, listing] = await Promise.all([
        Student.findById(connection.requester).select("phone").lean().catch(() => null),
        Student.findById(connection.receiver).select("firstName").lean().catch(() => null),
        FlatmateListing.findById(connection.receiverListing).select("bhk area city").lean().catch(() => null),
      ]);
      const listingSummaryText = listing ? `${listing.bhk} BHK · ${listing.area}, ${listing.city}` : "your requested listing";
      notifyFlatmateEvent("CONNECTION_REQUEST_ACCEPTED", {
        userId: connection.requester,
        title: "Your connection request was accepted",
        body: `${receiverDoc?.firstName || "They"} accepted your request on ${listingSummaryText}.`,
        link: `/messages/${conversation._id}`,
        relatedConnection: connection._id,
        relatedConversation: conversation._id,
        dedupeKey: connection._id.toString(),
        whatsapp: requesterDoc?.phone
          ? { phone: requesterDoc.phone, variables: [receiverDoc?.firstName || "The listing owner", listingSummaryText] }
          : null,
      });
    })();

    res.json({ success: true, conversationId: conversation._id.toString() });
  } catch (err) {
    console.error("Accept connection error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

/* ─────────────────────────────────────────────
   DECLINE  →  POST /messages/connection/:id/decline
───────────────────────────────────────────── */
router.post("/connection/:id/decline", requireStudent, async (req, res) => {
  try {
    const connection = await FlatmateConnection.findById(req.params.id);
    if (!connection || connection.receiver.toString() !== req.student.id || connection.status !== "pending") {
      return res.json({ success: false, error: "Request not found or already handled." });
    }
    connection.status = "declined";
    connection.declinedAt = new Date();
    await connection.save();

    notifyFlatmateEvent("CONNECTION_REQUEST_DECLINED", {
      userId: connection.requester,
      title: "Your connection request was declined",
      link: `/messages`,
      relatedConnection: connection._id,
      dedupeKey: connection._id.toString(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Decline connection error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

/* ─────────────────────────────────────────────
   REMOVE CONNECTION  →  POST /messages/connection/:id/remove
   Either participant can end an accepted connection. Never
   hard-deletes — status → "ended", conversation → "closed". This is
   also what re-locks the listing's private info (Phase 3's
   canSeePrivate check already re-derives from current status).
───────────────────────────────────────────── */
router.post("/connection/:id/remove", requireStudent, async (req, res) => {
  try {
    const connection = await FlatmateConnection.findById(req.params.id);
    const viewerId = req.student.id;
    if (!connection) return res.json({ success: false, error: "Connection not found." });
    if (connection.requester.toString() !== viewerId && connection.receiver.toString() !== viewerId) {
      return res.status(403).json({ success: false, error: "Not authorized." });
    }
    if (connection.status !== "accepted") {
      return res.json({ success: false, error: "This connection isn't currently active." });
    }

    connection.status = "ended";
    connection.endedAt = new Date();
    await connection.save();
    await Conversation.updateOne({ connection: connection._id }, { $set: { status: "closed" } });

    // Tell the OTHER participant — whoever didn't click Remove has no
    // other way to find out the connection just ended. In-app only.
    const otherId = connection.requester.toString() === viewerId ? connection.receiver : connection.requester;
    (async () => {
      const actorDoc = await Student.findById(viewerId).select("firstName").lean().catch(() => null);
      notifyFlatmateEvent("CONNECTION_REMOVED", {
        userId: otherId,
        title: `${actorDoc?.firstName || "A user"} ended your connection`,
        link: `/messages`,
        relatedConnection: connection._id,
        dedupeKey: connection._id.toString(),
      });
    })();

    res.json({ success: true });
  } catch (err) {
    console.error("Remove connection error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

/* ─────────────────────────────────────────────
   BLOCK USER  →  POST /messages/block/:studentId
   User-level block (not tied to one listing) — also ends any
   currently-accepted connection(s) between the two and closes their
   conversation(s), so private info re-locks and messaging stops
   immediately, consistent with Remove Connection's behavior.
───────────────────────────────────────────── */
router.post("/block/:studentId", requireStudent, async (req, res) => {
  try {
    const viewerId = req.student.id;
    const targetId = req.params.studentId;
    if (targetId === viewerId) {
      return res.json({ success: false, error: "You can't block yourself." });
    }

    await Block.updateOne(
      { blocker: viewerId, blocked: targetId },
      { $setOnInsert: { blocker: viewerId, blocked: targetId } },
      { upsert: true }
    );

    // End any live connections between the two, either direction.
    const connections = await FlatmateConnection.find({
      status: "accepted",
      $or: [
        { requester: viewerId, receiver: targetId },
        { requester: targetId, receiver: viewerId },
      ],
    });
    for (const connection of connections) {
      connection.status = "ended";
      connection.endedAt = new Date();
      await connection.save();
      await Conversation.updateOne({ connection: connection._id }, { $set: { status: "closed" } });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Block user error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

/* ─────────────────────────────────────────────
   REPORT  →  POST /messages/report
   Auditable moderation record — reporting does NOT itself block
   anyone (use Block for that). Reviewed at /admin/reports.
───────────────────────────────────────────── */
router.post("/report", requireStudent, async (req, res) => {
  try {
    const { reportedUserId, listingId, conversationId, reason, details } = req.body;
    const allowedReasons = ["Spam", "Fake profile", "Harassment", "Fraud / Scam", "Inappropriate content", "Other"];
    if (!reportedUserId || !allowedReasons.includes(reason)) {
      return res.json({ success: false, error: "Please select a valid reason." });
    }
    if (reportedUserId === req.student.id) {
      return res.json({ success: false, error: "You can't report yourself." });
    }

    const report = await Report.create({
      reporter: req.student.id,
      reportedUser: reportedUserId,
      relatedListing: listingId || null,
      relatedConversation: conversationId || null,
      reason,
      details: (details || "").trim().slice(0, 1000),
    });

    // A "we got it" receipt for the reporter — not a moderation outcome
    // (that's an admin/Phase-7 concern), just confirmation the report
    // was actually logged, since the modal closes immediately after.
    notifyFlatmateEvent("REPORT_RECEIVED", {
      userId: req.student.id,
      title: "Your report was received",
      body: "Our team will review it shortly.",
      dedupeKey: report._id.toString(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Report error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

/* ─────────────────────────────────────────────
   CHAT THREAD  →  GET /messages/:conversationId
───────────────────────────────────────────── */
router.get("/:conversationId", requireStudent, async (req, res) => {
  try {
    const viewerId = req.student.id;
    const conv = await Conversation.findById(req.params.conversationId)
      .populate("participants", "firstName")
      .populate("listing")
      .lean();

    if (!conv || !(conv.participants || []).some((p) => p._id.toString() === viewerId)) {
      return res.status(404).render("messages/conversation", {
        conversation: null, messages: [], counterpart: null, connection: null, viewerId: null,
      });
    }

    const counterpart = conv.participants.find((p) => p._id.toString() !== viewerId);
    const messages = await Message.find({ conversation: conv._id }).sort({ createdAt: 1 }).lean();

    let connection = null;
    if (conv.type === "FLATMATE_CONNECTION" && conv.connection) {
      connection = await FlatmateConnection.findById(conv.connection).lean();
    }

    // Opening the chat is itself proof the viewer's device received
    // everything sent so far AND that they're looking at it right now —
    // so this is the one place both "delivered" and "read" are stamped
    // together for the counterpart's messages.
    const now = new Date();
    await Conversation.updateOne({ _id: conv._id }, { $set: { [`unreadCounts.${viewerId}`]: 0 } });
    await Message.updateMany(
      { conversation: conv._id, sender: { $ne: viewerId }, readAt: null },
      { $set: { readAt: now } }
    );
    await Message.updateMany(
      { conversation: conv._id, sender: { $ne: viewerId }, deliveredAt: null },
      { $set: { deliveredAt: now } }
    );

    // Suggested opening lines — only for a Flatmate chat that's still
    // basically empty (the carried-over original request message may
    // already be the sole entry), and only while the connection is
    // still active. Which set depends on which side of the original
    // request the viewer was on.
    let suggestions = [];
    if (connection && conv.status === "active" && messages.length <= 2) {
      suggestions = connection.requester.toString() === viewerId ? SEEKER_SUGGESTIONS : LISTER_SUGGESTIONS;
    }

    res.render("messages/conversation", {
      conversation: conv,
      messages,
      counterpart,
      connection,
      viewerId,
      listingText: listingSummary(conv.listing, conv.listingModel),
      suggestions,
    });
  } catch (err) {
    console.error("Conversation view error:", err);
    res.status(500).send("Something went wrong loading this conversation. Please try again.");
  }
});

/* ─────────────────────────────────────────────
   SEND MESSAGE  →  POST /messages/:conversationId/messages
   Server-side gate: must be a participant, conversation must be
   "active", and (for Flatmate) the underlying connection must still
   be "accepted" — never trust the client's disabled input box alone.
───────────────────────────────────────────── */
router.post("/:conversationId/messages", requireStudent, async (req, res) => {
  try {
    const viewerId = req.student.id;
    const conv = await Conversation.findById(req.params.conversationId);

    if (!conv || !conv.participants.some((p) => p.toString() === viewerId)) {
      return res.status(403).json({ success: false, error: "Not authorized." });
    }
    if (conv.status !== "active") {
      return res.json({ success: false, error: "This conversation has ended." });
    }
    if (conv.type === "FLATMATE_CONNECTION") {
      const connection = await FlatmateConnection.findById(conv.connection);
      if (!connection || connection.status !== "accepted") {
        return res.json({ success: false, error: "This connection is no longer active." });
      }
    }

    const receiverId = conv.participants.find((p) => p.toString() !== viewerId);
    const blocked = await Block.findOne({
      $or: [
        { blocker: viewerId, blocked: receiverId },
        { blocker: receiverId, blocked: viewerId },
      ],
    });
    if (blocked) {
      return res.json({ success: false, error: "You can't message this user." });
    }

    const text = (req.body.text || "").trim().slice(0, 2000);
    if (!text) return res.json({ success: false, error: "Message can't be empty." });

    const message = await Message.create({ conversation: conv._id, sender: viewerId, text });

    conv.lastMessage = text.slice(0, 140);
    conv.lastMessageAt = new Date();
    const currentUnread = (conv.unreadCounts.get ? conv.unreadCounts.get(receiverId.toString()) : 0) || 0;
    conv.unreadCounts.set(receiverId.toString(), currentUnread + 1);
    await conv.save();

    // dedupeKey = this message's own id — each message is inherently a
    // distinct event, so this is just consistency with every other call
    // site rather than a real collision risk.
    notifyFlatmateEvent("NEW_MESSAGE", {
      userId: receiverId,
      title: "New message",
      body: text.slice(0, 80),
      link: `/messages/${conv._id}`,
      relatedConversation: conv._id,
      dedupeKey: message._id.toString(),
    });

    res.json({
      success: true,
      message: {
        _id: message._id.toString(), text: message.text, createdAt: message.createdAt, mine: true,
        deliveredAt: null, readAt: null,
      },
    });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ success: false, error: "Something went wrong sending your message." });
  }
});

/* ─────────────────────────────────────────────
   MARK READ  →  POST /messages/:conversationId/read
   Called by the chat page whenever it's actually visible and focused
   (on load, on tab refocus, and right after a new incoming message is
   appended while focused) — this is the real "the person looked at
   it" signal driving the blue double-tick, distinct from delivery.
───────────────────────────────────────────── */
router.post("/:conversationId/read", requireStudent, async (req, res) => {
  try {
    const viewerId = req.student.id;
    const conv = await Conversation.findById(req.params.conversationId);
    if (!conv || !conv.participants.some((p) => p.toString() === viewerId)) {
      return res.status(403).json({ success: false, error: "Not authorized." });
    }

    const now = new Date();
    await Conversation.updateOne({ _id: conv._id }, { $set: { [`unreadCounts.${viewerId}`]: 0 } });
    await Message.updateMany(
      { conversation: conv._id, sender: { $ne: viewerId }, readAt: null },
      { $set: { readAt: now } }
    );
    // Read implies delivered — cover the (rare) case a message was read
    // via this route before a poll cycle had a chance to mark it delivered.
    await Message.updateMany(
      { conversation: conv._id, sender: { $ne: viewerId }, deliveredAt: null },
      { $set: { deliveredAt: now } }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Could not mark as read." });
  }
});

/* ─────────────────────────────────────────────
   POLL FOR NEW MESSAGES  →  GET /messages/:conversationId/poll?after=<ISO date>
   Lightweight alternative to websockets (no socket.io in this project) —
   the chat page calls this every few seconds for near-real-time updates.
   Also doubles as the "delivered" signal: the viewer's client reaching
   this endpoint at all proves their device is live and has received
   whatever the other participant sent, independent of whether the tab
   is actually focused (that distinction is "read", handled above).
───────────────────────────────────────────── */
router.get("/:conversationId/poll", requireStudent, async (req, res) => {
  try {
    const viewerId = req.student.id;
    const conv = await Conversation.findById(req.params.conversationId);
    if (!conv || !conv.participants.some((p) => p.toString() === viewerId)) {
      return res.status(403).json({ success: false, error: "Not authorized." });
    }

    await Message.updateMany(
      { conversation: conv._id, sender: { $ne: viewerId }, deliveredAt: null },
      { $set: { deliveredAt: new Date() } }
    );

    const after = req.query.after ? new Date(req.query.after) : new Date(0);
    const newMessages = await Message.find({ conversation: conv._id, createdAt: { $gt: after } })
      .sort({ createdAt: 1 })
      .lean();

    // Status (delivered/read) for the viewer's OWN messages the other
    // side hasn't read yet, so ticks on already-rendered bubbles can be
    // upgraded live without a full page reload. Bounded to "not yet
    // read" ones since once a message is read its ticks never change
    // again, so there's nothing left to push.
    const pendingMine = await Message.find({ conversation: conv._id, sender: viewerId, readAt: null })
      .select("_id deliveredAt readAt")
      .lean();

    res.json({
      success: true,
      status: conv.status,
      messages: newMessages.map((m) => ({
        _id: m._id.toString(), text: m.text, createdAt: m.createdAt,
        mine: m.sender.toString() === viewerId,
        deliveredAt: m.deliveredAt, readAt: m.readAt,
      })),
      statusUpdates: pendingMine.map((m) => ({
        _id: m._id.toString(), deliveredAt: m.deliveredAt, readAt: m.readAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Poll failed." });
  }
});

module.exports = router;
