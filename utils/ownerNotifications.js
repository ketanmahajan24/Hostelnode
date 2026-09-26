// ============================================================
//  utils/ownerNotifications.js — HostelNode PG/Hostel chat
//  NEW FILE — Phase 5 of the PG/Hostel chat feature.
// ============================================================
/* ============================================================
   Sibling to utils/flatmateNotifications.js's notifyFlatmateEvent,
   for the same reason Phase 1 gave Conversation/Message their own
   parallel fields instead of overloading the Student-only ones:
   notifyFlatmateEvent's own file header, its EVENTS registry, and its
   Notification-model lookups are written throughout as Student-shaped
   and Flatmate-named ("Single entry point for every Flatmate
   lifecycle event"). Bending that function to also mean "or an Owner,
   for a PG/Hostel event" would blur what it documents itself as being.

   What IS reused, rather than duplicated, from that file:
     - the exact same models/Notification.js model (extended
       additively in this phase — see that file's own comments)
     - the exact same utils/leadWhatsapp.js sendTemplateMessage sender
     - the identical contract: fire-and-forget, never throws, never
       awaited in a request's response path, best-effort dedupeKey
       check, WhatsApp only attempted for an event this file's own
       registry actually lists (never guessed at by a caller)

   Only one event exists here today — PG_NEW_MESSAGE, for "a student
   sent this owner a message." If a later phase gives Owners more
   lifecycle events (e.g. a PG enquiry closing), they'd be added to
   this same EVENTS registry rather than starting a third file.
============================================================ */

const Notification = require("../models/Notification");

let sendTemplateMessage = null;
function waSender() {
  if (!sendTemplateMessage) sendTemplateMessage = require("./leadWhatsapp").sendTemplateMessage;
  return sendTemplateMessage;
}

const EVENTS = {
  // A student sends a message in a PG/Hostel conversation → notify the
  // listing's Owner.
  // WhatsApp template: WA_TEMPLATE_PG_NEW_MESSAGE — 1 var: student's
  // first name. No message text in the variables, on purpose — same
  // reasoning as flatmateNotifications.js's NEW_MESSAGE entry: a
  // WhatsApp Utility template is visible in notification previews, and
  // putting private chat content there would leak it beyond the app.
  //
  // IMPORTANT — unlike every Flatmate event, this template does not
  // exist in Meta Business Manager yet. Nothing in this codebase has
  // ever sent an Owner a WhatsApp message before this phase (checked:
  // no existing call site references an Owner's phone via
  // leadWhatsapp.js). Until "hostelnode_pg_new_message" (or whatever
  // name/env var you choose) is created, submitted, and approved as a
  // Utility template, sends will fail with a logged 🔴, exactly like
  // an unapproved Flatmate template does — never a crash, and the
  // in-app Notification below is unaffected either way.
  PG_NEW_MESSAGE: {
    notificationType: "PG_NEW_MESSAGE",
    whatsapp: () => process.env.WA_TEMPLATE_PG_NEW_MESSAGE || "hostelnode_pg_new_message",
    language: () => process.env.WA_TEMPLATE_PG_NEW_MESSAGE_LANG || "en_US",
  },
};

/**
 * notifyOwnerEvent(eventKey, payload)
 *
 * payload:
 *   userId               (required) — the Owner's _id
 *   title                (required)
 *   body                 (optional)
 *   link                 (optional)
 *   relatedConversation   (optional)
 *   dedupeKey            (optional)
 *   whatsapp             (optional) — { phone, variables }
 *
 * Same fire-and-forget contract as notifyFlatmateEvent: never await
 * this in a response's critical path, never throws.
 */
async function notifyOwnerEvent(eventKey, payload = {}) {
  try {
    const def = EVENTS[eventKey];
    if (!def) {
      console.error(`notifyOwnerEvent: unknown event "${eventKey}" — no notification sent.`);
      return;
    }

    const {
      userId, title, body = "", link = null,
      relatedConversation = null,
      dedupeKey = null, whatsapp = null,
    } = payload;

    if (!userId || !title) {
      console.error(`notifyOwnerEvent(${eventKey}): missing userId/title — no notification sent.`);
      return;
    }

    try {
      let alreadySent = false;
      if (dedupeKey) {
        const dupe = await Notification.findOne({ user: userId, type: def.notificationType, dedupeKey })
          .select("_id").lean();
        alreadySent = !!dupe;
      }
      if (alreadySent) {
        console.log(`notifyOwnerEvent(${eventKey}): duplicate suppressed for owner ${userId} (dedupeKey=${dedupeKey}).`);
      } else {
        await Notification.create({
          user: userId,
          userModel: "Owner",
          type: def.notificationType,
          title, body, link,
          relatedConversation,
          dedupeKey,
        });
      }
    } catch (err) {
      console.error(`notifyOwnerEvent(${eventKey}): in-app notification failed (non-critical):`, err.message);
    }

    if (!def.whatsapp) {
      if (whatsapp) {
        console.warn(`notifyOwnerEvent(${eventKey}): caller supplied a WhatsApp payload but this event has no template entry — ignoring it, in-app notification only.`);
      }
      return;
    }
    if (!whatsapp || !whatsapp.phone) return;

    setImmediate(async () => {
      try {
        const templateName = def.whatsapp();
        const languageCode = typeof def.language === "function" ? def.language() : "en";
        const send = waSender();
        const result = await send(whatsapp.phone, templateName, whatsapp.variables || [], whatsapp.headerImageUrl || null, languageCode);
        if (result.success) console.log(`✅ WA [${eventKey}] → ${whatsapp.phone}`);
        else console.error(`🔴 WA [${eventKey}] failed:`, result.error);
      } catch (e) {
        console.error(`WA [${eventKey}] notify failed (non-critical):`, e.message);
      }
    });
  } catch (err) {
    console.error(`notifyOwnerEvent(${eventKey}): unexpected failure (non-critical):`, err.message);
  }
}

module.exports = { notifyOwnerEvent, OWNER_NOTIFICATION_EVENTS: EVENTS };
