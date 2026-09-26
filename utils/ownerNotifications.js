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
  // A student sends a message in a PG/Hostel conversation (or submits
  // one of the Contact Owner modal's enquiry options — Phase 7 mirrors
  // those into this same event) → notify the listing's Owner.
  //
  // WhatsApp template: WA_TEMPLATE_PG_NEW_MESSAGE — 4 vars, in order:
  //   {{1}} sender's full name
  //   {{2}} the PG/Hostel listing's name (conv.listing's title)
  //   {{3}} sender's phone number
  //   {{4}} the message text itself (truncated to 200 chars by the
  //         caller before it ever reaches here)
  //
  // Phase 7, explicit product decision: unlike Flatmate's NEW_MESSAGE
  // (which deliberately omits message content — see that file's own
  // comment), this one DOES put the student's name, phone, and actual
  // message text in the template body, so the Owner can see and act
  // on it straight from the WhatsApp notification. Trade-off, on the
  // record: the message text is now visible in notification previews/
  // lock screens, not just inside the app — accepted deliberately here.
  //
  // IMPORTANT — this template does not exist in Meta Business Manager
  // yet, and even if an earlier 3-variable version was ever submitted,
  // Meta treats a variable-count change as a DIFFERENT template that
  // needs its own approval — editing the approved text in place does
  // not silently apply. Submit (or resubmit) something like this as a
  // Utility-category template named "hostelnode_pg_new_message"
  // (asterisks = WhatsApp's own bold markup, applies to the rendered
  // variable too):
  //
  //   💬 *{{1}}* sent you a message about *{{2}}*!
  //
  //   📱 {{3}}
  //   📝 "{{4}}"
  //
  //   Reply on HostelNode to chat back.
  //
  // Header (static text, no variable): "New Message on HostelNode 💬"
  //
  // Until that's approved, sends fail with a logged 🔴 (never a
  // crash), and the in-app Notification below is unaffected either way.
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
