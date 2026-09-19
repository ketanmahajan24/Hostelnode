// ============================================================
//  utils/flatmateNotifications.js — HostelNode Flatmate
//  Centralized lifecycle notification service (Phase 5, WhatsApp
//  coverage extended to all 10 events in Phase 8)
// ============================================================
/* ============================================================
   Single entry point for every Flatmate lifecycle event: writes the
   in-app Notification, and — for every event below whose `whatsapp`
   entry is a function rather than `null` — also sends a WhatsApp
   template message. As of Phase 8, all 10 events have a template
   name wired up (env var, with a fallback literal name matching the
   existing FLATMATE_WA_TEMPLATES pattern). Treat "wired up" and
   "approved" as separate facts: this service will happily call
   Meta's API for any of these, but until each template is actually
   submitted and approved in Meta Business Manager, Meta will reject
   the send (logged as a 🔴 WA failure, not a crash — never affects
   the in-app notification or the request that triggered it). See the
   final-report doc's "Remaining limitations" section for the
   env-var-to-template mapping and draft wording to submit. Fabricating
   WhatsApp *code* for an event Meta was never asked to approve at all
   is what this file refuses to do — the EVENTS registry below is the
   single source of truth for which events even attempt WhatsApp, and
   a caller cannot accidentally turn it on for an event that isn't
   wired for it (see the hard guard in notifyFlatmateEvent below).
   Flip an event's `whatsapp` back to `null` if you ever need to pull
   WhatsApp for it without touching any call site.

   Contract for every call site:
   - Call this AFTER the core action's own .save()/.create() has
     already committed, and do NOT await it in the request's response
     path. A failure in here (a Mongo hiccup, Meta's API being down, a
     missing/invalid phone number) can NEVER roll back or fail the
     action that triggered it — every internal step is try/caught, and
     this function itself never throws or rejects.
   - Pass `dedupeKey` for any event that could plausibly fire more than
     once for the same real-world occurrence (a retried request, a
     double form submit that still reaches this point). A best-effort
     check against (user, type, dedupeKey) skips creating a second
     Notification. This is a find-then-create check, not a unique-index
     guarantee — deliberately, since a notification duplicating under a
     genuine race is a cosmetic issue, not a data-integrity one, and
     doesn't warrant the same hard guarantee Phase 2's clientRequestId
     gives the listing-publish flow.
============================================================ */

const Notification = require("../models/Notification");

let sendTemplateMessage = null;
function waSender() {
  // Lazily required, matching every existing WhatsApp call site in
  // this codebase — avoids a hard dependency at module-load time.
  if (!sendTemplateMessage) sendTemplateMessage = require("./leadWhatsapp").sendTemplateMessage;
  return sendTemplateMessage;
}

/* ── Event registry ──────────────────────────────────────────
   notificationType must be a value already in models/Notification.js's
   `type` enum. whatsapp is either null ("no approved template — in-app
   only") or a () => templateName function reading from env (mirrors
   the existing FLATMATE_WA_TEMPLATES pattern in flatmateRoutes.js).

   language — REQUIRED alongside whatsapp, and must match that exact
   template's "Language" column in WhatsApp Manager. Meta treats "en"
   and "en_US" as different translations of the same template name; a
   mismatch fails with API error 132001 ("template name does not exist
   in the translation") even when the template is genuinely approved.
   This bit us in production: hostelnode_flatmate_accepted and
   hostelnode_flatmate_removed were both approved as English (US) —
   en_US — but the send code was hardcoded to "en". Every entry below
   is overridable via its own env var so a template's language can be
   corrected without a code change if Meta's UI shows something
   different than what's set here.
──────────────────────────────────────────────────────────── */
const EVENTS = {
  // Someone sends a connection request → notify the listing owner.
  CONNECTION_REQUEST_RECEIVED: {
    notificationType: "FLATMATE_CONNECTION_REQUEST",
    whatsapp: () => process.env.WA_TEMPLATE_FLATMATE_REQUEST || "hostelnode_flatmate_request",
    language: () => process.env.WA_TEMPLATE_FLATMATE_REQUEST_LANG || "en",
  },
  // A request is accepted → notify the requester.
  // Production log showed this failing under "en" (132001) — set to
  // en_US to match; CONFIRM against WhatsApp Manager's Language column
  // and override via WA_TEMPLATE_FLATMATE_ACCEPTED_LANG if different.
  CONNECTION_REQUEST_ACCEPTED: {
    notificationType: "FLATMATE_REQUEST_ACCEPTED",
    whatsapp: () => process.env.WA_TEMPLATE_FLATMATE_ACCEPTED || "hostelnode_flatmate_accepted",
    language: () => process.env.WA_TEMPLATE_FLATMATE_ACCEPTED_LANG || "en_US",
  },
  // A request is declined → notify the requester.
  // Template: WA_TEMPLATE_FLATMATE_DECLINED — 1 var: listing summary.
  // NOTE: as of 20 Sep 2026 this template was auto-reclassified by
  // Meta from Utility to Marketing (visible in WhatsApp Manager's
  // "needs your attention" banner) — likely the "Explore more
  // listings" line read as promotional. A Marketing-category template
  // needs recipient opt-in to deliver at all, so this will keep
  // failing/under-delivering regardless of the language fix until
  // either a review is requested (24hr window from the flag) or the
  // wording is resubmitted less promotionally. Language set for when
  // it does go through.
  CONNECTION_REQUEST_DECLINED: {
    notificationType: "FLATMATE_REQUEST_DECLINED",
    whatsapp: () => process.env.WA_TEMPLATE_FLATMATE_DECLINED || "hostelnode_flatmate_declined",
    language: () => process.env.WA_TEMPLATE_FLATMATE_DECLINED_LANG || "en_US",
  },
  // The requester cancels their own pending request → notify the
  // receiver, who otherwise has no way to know it's gone.
  // Template: WA_TEMPLATE_FLATMATE_CANCELLED — 1 var: requester's name.
  CONNECTION_REQUEST_CANCELLED: {
    notificationType: "FLATMATE_REQUEST_CANCELLED",
    whatsapp: () => process.env.WA_TEMPLATE_FLATMATE_CANCELLED || "hostelnode_flatmate_cancelled",
    language: () => process.env.WA_TEMPLATE_FLATMATE_CANCELLED_LANG || "en_US",
  },
  // Either side ends an accepted connection → notify the other side.
  // Template: WA_TEMPLATE_FLATMATE_REMOVED — 1 var: the other person's name.
  // Confirmed en_US from the production 132001 error + WhatsApp
  // Manager's Language column (20 Sep 2026).
  CONNECTION_REMOVED: {
    notificationType: "FLATMATE_CONNECTION_REMOVED",
    whatsapp: () => process.env.WA_TEMPLATE_FLATMATE_REMOVED || "hostelnode_flatmate_removed",
    language: () => process.env.WA_TEMPLATE_FLATMATE_REMOVED_LANG || "en_US",
  },
  // A new chat message → notify the recipient.
  // Template: WA_TEMPLATE_FLATMATE_NEW_MESSAGE — 1 var: sender's name.
  // Deliberately does NOT include the message text as a variable — a
  // WhatsApp Utility template is visible in notification previews, and
  // putting private chat content there would leak it beyond the app.
  NEW_MESSAGE: {
    notificationType: "FLATMATE_NEW_MESSAGE",
    whatsapp: () => process.env.WA_TEMPLATE_FLATMATE_NEW_MESSAGE || "hostelnode_flatmate_new_message",
    language: () => process.env.WA_TEMPLATE_FLATMATE_NEW_MESSAGE_LANG || "en_US",
  },
  // A listing owner closes their listing → notify anyone with a
  // still-pending request on it, since it will never be actioned now.
  // Template: WA_TEMPLATE_FLATMATE_LISTING_CLOSED — 1 var: listing summary.
  LISTING_CLOSED: {
    notificationType: "LISTING_CLOSED",
    whatsapp: () => process.env.WA_TEMPLATE_FLATMATE_LISTING_CLOSED || "hostelnode_flatmate_listing_closed",
    language: () => process.env.WA_TEMPLATE_FLATMATE_LISTING_CLOSED_LANG || "en_US",
  },
  // A listing owner pauses their listing → same reasoning as above,
  // kept as a distinct (softer) notification type since a pause is
  // reversible and the requester's chances aren't necessarily gone.
  // Template: WA_TEMPLATE_FLATMATE_LISTING_PAUSED — 1 var: listing summary.
  // NOTE: this one is genuinely "English" (en), not "English (US)", in
  // WhatsApp Manager — it's the one exception among the 8 new templates.
  LISTING_PAUSED: {
    notificationType: "FLATMATE_LISTING_PAUSED",
    whatsapp: () => process.env.WA_TEMPLATE_FLATMATE_LISTING_PAUSED || "hostelnode_flatmate_listing_paused",
    language: () => process.env.WA_TEMPLATE_FLATMATE_LISTING_PAUSED_LANG || "en",
  },
  // Confirms to the REPORTER that their report was logged — purely a
  // "we got it" receipt, not a moderation outcome.
  // Template: WA_TEMPLATE_FLATMATE_REPORT_RECEIVED — 0 vars.
  REPORT_RECEIVED: {
    notificationType: "FLATMATE_REPORT_RECEIVED",
    whatsapp: () => process.env.WA_TEMPLATE_FLATMATE_REPORT_RECEIVED || "hostelnode_flatmate_report_received",
    language: () => process.env.WA_TEMPLATE_FLATMATE_REPORT_RECEIVED_LANG || "en_US",
  },
  // Confirms to the OWNER that their listing was published/submitted —
  // separate from the create-success page (Phase 2), which only the
  // owner sees at that moment; this is the durable record of it.
  // Template: WA_TEMPLATE_FLATMATE_LISTING_PUBLISHED — 1 var: listing summary.
  LISTING_PUBLISHED: {
    notificationType: "FLATMATE_LISTING_PUBLISHED",
    whatsapp: () => process.env.WA_TEMPLATE_FLATMATE_LISTING_PUBLISHED || "hostelnode_flatmate_listing_published",
    language: () => process.env.WA_TEMPLATE_FLATMATE_LISTING_PUBLISHED_LANG || "en_US",
  },
};

/**
 * notifyFlatmateEvent(eventKey, payload)
 *
 * payload:
 *   userId               (required) — who the in-app notification is for
 *   title                (required)
 *   body                 (optional)
 *   link                 (optional) — where the notification navigates
 *   relatedConnection / relatedConversation / relatedListing (optional)
 *   dedupeKey            (optional) — see file header
 *   whatsapp             (optional) — { phone, variables, headerImageUrl }
 *                         Only used if this event's registry entry has
 *                         an approved template; otherwise it's ignored
 *                         (with a warning) rather than silently "working".
 *
 * Fire-and-forget by design: never await this in a response's critical
 * path. It never throws.
 */
async function notifyFlatmateEvent(eventKey, payload = {}) {
  try {
    const def = EVENTS[eventKey];
    if (!def) {
      console.error(`notifyFlatmateEvent: unknown event "${eventKey}" — no notification sent.`);
      return;
    }

    const {
      userId, title, body = "", link = null,
      relatedConnection = null, relatedConversation = null, relatedListing = null,
      dedupeKey = null, whatsapp = null,
    } = payload;

    if (!userId || !title) {
      console.error(`notifyFlatmateEvent(${eventKey}): missing userId/title — no notification sent.`);
      return;
    }

    // ── In-app notification, with best-effort de-duplication ──
    try {
      let alreadySent = false;
      if (dedupeKey) {
        const dupe = await Notification.findOne({ user: userId, type: def.notificationType, dedupeKey })
          .select("_id").lean();
        alreadySent = !!dupe;
      }
      if (alreadySent) {
        console.log(`notifyFlatmateEvent(${eventKey}): duplicate suppressed for user ${userId} (dedupeKey=${dedupeKey}).`);
      } else {
        await Notification.create({
          user: userId, type: def.notificationType, title, body, link,
          relatedConnection, relatedConversation, relatedListing,
          dedupeKey,
        });
      }
    } catch (err) {
      console.error(`notifyFlatmateEvent(${eventKey}): in-app notification failed (non-critical):`, err.message);
    }

    // ── WhatsApp — only for events the registry actually covers ──
    if (!def.whatsapp) {
      if (whatsapp) {
        console.warn(`notifyFlatmateEvent(${eventKey}): caller supplied a WhatsApp payload but this event has no approved template — ignoring it, in-app notification only.`);
      }
      return;
    }
    if (!whatsapp || !whatsapp.phone) return;

    setImmediate(async () => {
      try {
        const templateName = def.whatsapp();
        // def.language is required for every WA-enabled event (see the
        // registry comment above EVENTS) — "en" only as a last-resort
        // fallback if an entry is somehow missing it, matching the old
        // (buggy) hardcoded default so behavior degrades gracefully
        // rather than throwing.
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
    // Belt-and-braces: nothing above should reach here, but this
    // function must be safe to call unawaited from any core action
    // without ever becoming an unhandled rejection.
    console.error(`notifyFlatmateEvent(${eventKey}): unexpected failure (non-critical):`, err.message);
  }
}

module.exports = { notifyFlatmateEvent, FLATMATE_NOTIFICATION_EVENTS: EVENTS };
