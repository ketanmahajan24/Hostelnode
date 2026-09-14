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
const Notification       = require("../models/Notification");
const Block              = require("../models/Block");
const Report             = require("../models/Report");
const Student            = require("../models/studentSchema");
const FlatmateListing    = require("../models/FlatmateListing");

const FLATMATE_WA_TEMPLATE_ACCEPTED = process.env.WA_TEMPLATE_FLATMATE_ACCEPTED || "hostelnode_flatmate_accepted";

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
    }

    Notification.create({
      user: connection.requester,
      type: "FLATMATE_REQUEST_ACCEPTED",
      title: "Your connection request was accepted",
      link: `/messages/${conversation._id}`,
      relatedConnection: connection._id,
      relatedConversation: conversation._id,
    }).catch(() => {});

    // WhatsApp notify the requester — fires exactly once, only on this
    // actual pending->accepted transition (the guard above already
    // prevents a second accept call from reaching this code at all).
    // Non-critical: acceptance has already been fully saved above
    // regardless of whether this notification succeeds.
    setImmediate(async () => {
      try {
        const { sendTemplateMessage } = require("../utils/leadWhatsapp");
        const [requesterDoc, receiverDoc, listing] = await Promise.all([
          Student.findById(connection.requester).select("phone"),
          Student.findById(connection.receiver).select("firstName"),
          FlatmateListing.findById(connection.receiverListing).select("bhk area city"),
        ]);
        if (!requesterDoc?.phone) return;
        const result = await sendTemplateMessage(
          requesterDoc.phone,
          FLATMATE_WA_TEMPLATE_ACCEPTED,
          [receiverDoc?.firstName || "The listing owner", listing ? `${listing.bhk} BHK · ${listing.area}, ${listing.city}` : "your requested listing"]
        );
        if (result.success) console.log(`✅ Flatmate acceptance WA notify → ${requesterDoc.phone}`);
        else console.error("🔴 Flatmate acceptance WA notify failed:", result.error);
      } catch (e) {
        console.error("WA flatmate-accepted notify failed (non-critical):", e.message);
      }
    });

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

    Notification.create({
      user: connection.requester,
      type: "FLATMATE_REQUEST_DECLINED",
      title: "Your connection request was declined",
      relatedConnection: connection._id,
    }).catch(() => {});

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

    await Report.create({
      reporter: req.student.id,
      reportedUser: reportedUserId,
      relatedListing: listingId || null,
      relatedConversation: conversationId || null,
      reason,
      details: (details || "").trim().slice(0, 1000),
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

    // Mark as read for this viewer — reset their unread counter and
    // stamp readAt on the counterpart's messages.
    await Conversation.updateOne({ _id: conv._id }, { $set: { [`unreadCounts.${viewerId}`]: 0 } });
    await Message.updateMany(
      { conversation: conv._id, sender: { $ne: viewerId }, readAt: null },
      { $set: { readAt: new Date() } }
    );

    res.render("messages/conversation", {
      conversation: conv,
      messages,
      counterpart,
      connection,
      viewerId,
      listingText: listingSummary(conv.listing, conv.listingModel),
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

    Notification.create({
      user: receiverId,
      type: "FLATMATE_NEW_MESSAGE",
      title: "New message",
      body: text.slice(0, 80),
      link: `/messages/${conv._id}`,
      relatedConversation: conv._id,
    }).catch(() => {});

    res.json({
      success: true,
      message: { _id: message._id.toString(), text: message.text, createdAt: message.createdAt, mine: true },
    });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ success: false, error: "Something went wrong sending your message." });
  }
});

/* ─────────────────────────────────────────────
   POLL FOR NEW MESSAGES  →  GET /messages/:conversationId/poll?after=<ISO date>
   Lightweight alternative to websockets (no socket.io in this project) —
   the chat page calls this every few seconds for near-real-time updates.
───────────────────────────────────────────── */
router.get("/:conversationId/poll", requireStudent, async (req, res) => {
  try {
    const viewerId = req.student.id;
    const conv = await Conversation.findById(req.params.conversationId);
    if (!conv || !conv.participants.some((p) => p.toString() === viewerId)) {
      return res.status(403).json({ success: false, error: "Not authorized." });
    }

    const after = req.query.after ? new Date(req.query.after) : new Date(0);
    const messages = await Message.find({ conversation: conv._id, createdAt: { $gt: after } })
      .sort({ createdAt: 1 })
      .lean();

    res.json({
      success: true,
      status: conv.status,
      messages: messages.map((m) => ({
        _id: m._id.toString(), text: m.text, createdAt: m.createdAt, mine: m.sender.toString() === viewerId,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Poll failed." });
  }
});

module.exports = router;
