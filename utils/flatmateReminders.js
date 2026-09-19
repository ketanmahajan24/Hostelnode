// ============================================================
//  utils/flatmateReminders.js — HostelNode Flatmate (Phase 10)
// ============================================================
/* ============================================================
   Time-based Flatmate notifications — the ones that fire because a
   certain amount of time has passed, rather than in direct response
   to a user action. Run on a schedule from app.js (see the Phase 10
   cron block there). Every window below is an assumption, not a
   product spec — this codebase had none of these before Phase 10 —
   and every one is overridable via env var without a code change.

   Each sweep function is independent and wrapped in its own
   try/catch so one failing sweep (a bad query, a transient DB hiccup)
   can never stop the others from running.
============================================================ */

const FlatmateConnection = require("../models/FlatmateConnection");
const Conversation = require("../models/Conversation");
const FlatmateListing = require("../models/FlatmateListing");
const Student = require("../models/studentSchema");
const { notifyFlatmateEvent } = require("./flatmateNotifications");

const PENDING_REMINDER_HOURS = parseFloat(process.env.FLATMATE_PENDING_REMINDER_HOURS) || 24;
const UNREAD_REMINDER_HOURS = parseFloat(process.env.FLATMATE_UNREAD_REMINDER_HOURS) || 3;
const EXPIRY_WARNING_DAYS = parseFloat(process.env.FLATMATE_EXPIRY_WARNING_DAYS) || 7;
const PAUSE_REMINDER_DAYS = parseFloat(process.env.FLATMATE_PAUSE_REMINDER_DAYS) || 7;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ── 1. Pending request reminder ──────────────────────────────
async function sweepPendingRequestReminders() {
  try {
    const cutoff = new Date(Date.now() - PENDING_REMINDER_HOURS * HOUR_MS);
    const pending = await FlatmateConnection.find({
      status: "pending",
      createdAt: { $lte: cutoff },
      pendingReminderSentAt: null,
    }).select("_id receiver requester receiverListing").populate("requester", "firstName").populate("receiverListing", "bhk area city");

    for (const conn of pending) {
      const receiverDoc = await Student.findById(conn.receiver).select("phone").lean().catch(() => null);
      const requesterName = conn.requester?.firstName || "Someone";
      const listingSummaryText = conn.receiverListing
        ? `${conn.receiverListing.bhk} BHK · ${conn.receiverListing.area}, ${conn.receiverListing.city}`
        : "your listing";
      notifyFlatmateEvent("CONNECTION_REQUEST_PENDING_REMINDER", {
        userId: conn.receiver,
        title: `Reminder: ${requesterName} is still waiting on your response`,
        body: listingSummaryText,
        link: `/messages`,
        relatedConnection: conn._id,
        dedupeKey: `CONNECTION_REQUEST_PENDING_REMINDER:${conn._id.toString()}`,
        whatsapp: receiverDoc?.phone ? { phone: receiverDoc.phone, variables: [requesterName, listingSummaryText] } : null,
      });
      await FlatmateConnection.updateOne({ _id: conn._id }, { $set: { pendingReminderSentAt: new Date() } }).catch(() => {});
    }
    if (pending.length) console.log(`🔔 Pending-request reminders sent: ${pending.length}`);
  } catch (err) {
    console.error("sweepPendingRequestReminders failed (non-critical):", err.message);
  }
}

// ── 2. Unread message reminder ───────────────────────────────
async function sweepUnreadMessageReminders() {
  try {
    const cutoff = new Date(Date.now() - UNREAD_REMINDER_HOURS * HOUR_MS);
    const conversations = await Conversation.find({
      status: "active",
      lastMessageAt: { $lte: cutoff, $ne: null },
    }).select("_id participants unreadCounts unreadReminderSentAt lastMessage");

    let sent = 0;
    for (const conv of conversations) {
      for (const participantId of conv.participants) {
        const pid = participantId.toString();
        const unread = (conv.unreadCounts.get ? conv.unreadCounts.get(pid) : conv.unreadCounts[pid]) || 0;
        if (unread <= 0) continue;
        const alreadyReminded = conv.unreadReminderSentAt.get ? conv.unreadReminderSentAt.get(pid) : conv.unreadReminderSentAt[pid];
        if (alreadyReminded) continue;

        const recipientDoc = await Student.findById(pid).select("phone").lean().catch(() => null);
        notifyFlatmateEvent("MESSAGE_UNREAD_REMINDER", {
          userId: pid,
          title: unread === 1 ? "You have an unread message" : `You have ${unread} unread messages`,
          body: conv.lastMessage || "",
          link: `/messages/${conv._id}`,
          relatedConversation: conv._id,
          dedupeKey: `MESSAGE_UNREAD_REMINDER:${conv._id.toString()}:${pid}`,
          whatsapp: recipientDoc?.phone ? { phone: recipientDoc.phone, variables: [] } : null,
        });
        await Conversation.updateOne({ _id: conv._id }, { $set: { [`unreadReminderSentAt.${pid}`]: new Date() } }).catch(() => {});
        sent++;
      }
    }
    if (sent) console.log(`🔔 Unread-message reminders sent: ${sent}`);
  } catch (err) {
    console.error("sweepUnreadMessageReminders failed (non-critical):", err.message);
  }
}

// ── 3. Listing expiring soon (warning) ───────────────────────
async function sweepExpiringSoonWarnings() {
  try {
    const now = new Date();
    const warnBefore = new Date(now.getTime() + EXPIRY_WARNING_DAYS * DAY_MS);
    const listings = await FlatmateListing.find({
      status: "ACTIVE",
      expiresAt: { $ne: null, $lte: warnBefore, $gt: now },
      expiryWarnedAt: null,
    }).select("_id student bhk area city slug expiresAt");

    for (const listing of listings) {
      const ownerDoc = await Student.findById(listing.student).select("phone").lean().catch(() => null);
      const listingSummaryText = `${listing.bhk} BHK · ${listing.area}, ${listing.city}`;
      const daysLeft = Math.max(1, Math.round((listing.expiresAt - now) / DAY_MS));
      notifyFlatmateEvent("LISTING_EXPIRING_SOON", {
        userId: listing.student,
        title: `Your listing expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        body: listingSummaryText,
        link: `/flatmate/${listing.slug}`,
        relatedListing: listing._id,
        dedupeKey: `LISTING_EXPIRING_SOON:${listing._id.toString()}`,
        whatsapp: ownerDoc?.phone ? { phone: ownerDoc.phone, variables: [listingSummaryText] } : null,
      });
      await FlatmateListing.updateOne({ _id: listing._id }, { $set: { expiryWarnedAt: now } }).catch(() => {});
    }
    if (listings.length) console.log(`🔔 Expiring-soon warnings sent: ${listings.length}`);
  } catch (err) {
    console.error("sweepExpiringSoonWarnings failed (non-critical):", err.message);
  }
}

// ── 4. Auto-expire listings past expiresAt ───────────────────
async function sweepAutoExpireListings() {
  try {
    // Required here (not at module top) to avoid a require cycle:
    // flatmateRoutes.js requires utils/flatmateActivation.js, which
    // could plausibly grow to require this file back — keeping this
    // one lazy sidesteps that entirely.
    const { notifyPendingRequesters } = require("../routes/flatmateRoutes");

    const now = new Date();
    const listings = await FlatmateListing.find({
      status: "ACTIVE",
      expiresAt: { $ne: null, $lte: now },
    }).select("_id student bhk area city slug");

    for (const listing of listings) {
      listing.status = "CLOSED";
      await listing.save();

      notifyPendingRequesters(listing, "LISTING_CLOSED", "expired automatically after its listing period");

      const ownerDoc = await Student.findById(listing.student).select("phone").lean().catch(() => null);
      const listingSummaryText = `${listing.bhk} BHK · ${listing.area}, ${listing.city}`;
      notifyFlatmateEvent("LISTING_EXPIRED", {
        userId: listing.student,
        title: "Your listing has expired",
        body: `${listingSummaryText} — republish it anytime to make it visible again.`,
        link: `/flatmate/my-listings`,
        relatedListing: listing._id,
        dedupeKey: `LISTING_EXPIRED:${listing._id.toString()}`,
        whatsapp: ownerDoc?.phone ? { phone: ownerDoc.phone, variables: [listingSummaryText] } : null,
      });
    }
    if (listings.length) console.log(`⏱️ Listings auto-expired: ${listings.length}`);
  } catch (err) {
    console.error("sweepAutoExpireListings failed (non-critical):", err.message);
  }
}

// ── 5. Re-activate reminder (long-paused listings) ───────────
async function sweepReactivateReminders() {
  try {
    const cutoff = new Date(Date.now() - PAUSE_REMINDER_DAYS * DAY_MS);
    const listings = await FlatmateListing.find({
      status: "PAUSED",
      pausedAt: { $ne: null, $lte: cutoff },
      pauseReminderSentAt: null,
    }).select("_id student bhk area city slug");

    for (const listing of listings) {
      const ownerDoc = await Student.findById(listing.student).select("phone").lean().catch(() => null);
      const listingSummaryText = `${listing.bhk} BHK · ${listing.area}, ${listing.city}`;
      notifyFlatmateEvent("LISTING_REACTIVATE_REMINDER", {
        userId: listing.student,
        title: "Your listing has been paused for a while",
        body: listingSummaryText,
        link: `/flatmate/my-listings`,
        relatedListing: listing._id,
        dedupeKey: `LISTING_REACTIVATE_REMINDER:${listing._id.toString()}`,
        whatsapp: ownerDoc?.phone ? { phone: ownerDoc.phone, variables: [listingSummaryText] } : null,
      });
      await FlatmateListing.updateOne({ _id: listing._id }, { $set: { pauseReminderSentAt: new Date() } }).catch(() => {});
    }
    if (listings.length) console.log(`🔔 Re-activate reminders sent: ${listings.length}`);
  } catch (err) {
    console.error("sweepReactivateReminders failed (non-critical):", err.message);
  }
}

// Runs every sweep. Each is independently try/caught above, so a
// failure in one never stops the rest — this function itself can't
// throw either.
async function runFlatmateReminderSweep() {
  await sweepPendingRequestReminders();
  await sweepUnreadMessageReminders();
  await sweepExpiringSoonWarnings();
  await sweepAutoExpireListings();
  await sweepReactivateReminders();
}

module.exports = {
  runFlatmateReminderSweep,
  sweepPendingRequestReminders,
  sweepUnreadMessageReminders,
  sweepExpiringSoonWarnings,
  sweepAutoExpireListings,
  sweepReactivateReminders,
};
