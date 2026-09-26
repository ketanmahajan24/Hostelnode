# Phase 7 — enquiry-into-Messages + real WhatsApp content (main HostelNode.com repo)

Two changes, both built against `origin/main` (what's actually deployed
in production right now, confirmed live after your PM2 restart) — see
the **heads-up** below before you copy these in.

## 1. "Chat with Owner" was already wired. The other 4 options weren't.

The Contact Owner modal has 5 options. "Chat with Owner" already
creates/reuses a real conversation (`POST /messages/pg/start`, Phase
2). The other 4 — Request Callback, WhatsApp Callback, Schedule
Visit, Virtual Tour — only ever created an `Enquiry` lead record and
sent you a WhatsApp template; nothing about them touched
Conversation/Message, so they never showed up in the Owner's Messages
inbox.

Now, whichever of those 4 a student picks, in addition to the
existing Enquiry (unchanged — your leads pipeline still works exactly
as before), it also:

- finds-or-creates the same PG_INQUIRY conversation `pg/start` would
  (new shared helper, `utils/pgConversation.js`, so both call sites
  can't drift apart)
- posts one message into it summarizing what was requested, e.g.:
  `Requested a physical visit · Move-in: Within 1 month · Budget: ₹8,000 – ₹12,000 · Message: near college gate please`
- bumps `lastMessage`/`lastMessageAt`/unread count so it surfaces in
  the Owner's inbox like any other conversation
- fires the same `PG_NEW_MESSAGE` in-app + WhatsApp notify a real chat
  message would (see #2 below)

All of it is wrapped in try/catch and runs *after* the Enquiry is
already saved — if this new part ever fails, the enquiry + existing
lead-template WhatsApp still go through exactly as before. Nothing
about the Enquiry model, the lead-scoring, or the 4 existing lead
WhatsApp templates was touched.

**Files:**
- `utils/pgConversation.js` — **new file**, add it.
- `routes/studentRoutes.js` — replace with the version in this zip.
  Diffed against your live `origin/main` copy — the only change is one
  new block (~65 lines) inserted between the existing "Lead pipeline
  log" and "Notify owner via WhatsApp template" sections. Nothing else
  in this 1185-line file was touched.

## 2. Owner's WhatsApp notification now carries the real message

Until now, `PG_NEW_MESSAGE` (the template sent to an Owner when a
student messages them) only ever carried the student's first name —
by design, so private chat text wouldn't leak into a notification
preview. You've asked to change that: the notification should now
show the student's name, phone number, and their actual message.

**What changed:**
- `utils/ownerNotifications.js` — `PG_NEW_MESSAGE`'s registry comment
  rewritten to describe 4 variables instead of 1, and the exact
  template text you need to submit to Meta (see below).
- `routes/messagesRoutes.js` — the Owner-notify branch inside the
  send-message route now also selects the sender's `lastName`/`phone`
  and looks up the conversation's listing name (`Listing.findById
  (conv.listing).select("title")` — `conv.listing` is only an ObjectId
  on this doc, never populated here), and passes
  `[name, listing name, phone, message text (max 200 chars)]` as the
  template variables, instead of just `[firstName]`. Diffed against
  `origin/main` — that's the *only* change in this file; the
  Flatmate-side branch right above it, and every other route in the
  file, is byte-for-byte identical to what's live.
- `routes/studentRoutes.js`'s enquiry-mirror code (change #1 above)
  reuses `resolvedHostelName` (already computed earlier in that same
  route) as the listing-name variable, so an enquiry-triggered message
  and a real chat message look consistent on WhatsApp.

**Action required on your end — this needs a Meta template:**
WhatsApp Business API only lets you send pre-approved *template*
messages outside a 24-hour customer-reply window (that's what
`sendTemplateMessage` in `utils/leadWhatsapp.js` uses, and it's the
only sender either of these files calls). You can't just start
sending arbitrary text — Meta has to approve the template body first,
and any variable-count change means a NEW template submission, not an
edit to an existing approved one. Submit this as a
**Utility**-category template named `hostelnode_pg_new_message`:

- **Header (Text, static, no variable):** `New Message on HostelNode 💬`
- **Body:**
  ```
  💬 *{{1}}* sent you a message about *{{2}}*!

  📱 {{3}}
  📝 "{{4}}"

  Reply on HostelNode to chat back.
  ```
  Sample values: `{{1}}` → `Ketan Mahajan`, `{{2}}` → `Green Valley PG`,
  `{{3}}` → `9876543210`, `{{4}}` → `Is the room still available for next month?`
- **Button (Call to Action → Visit Website, Static URL):**
  Text: `Open Chat` · URL: `https://manage.hostelnode.com/user/messages`
  (opens inside WhatsApp's own in-app browser, not the phone's regular
  browser/Chrome — that's WhatsApp's own behavior, not something this
  code or the template can override. It's also a separate cookie jar
  from the owner's normal browser, so they may need to log in again
  when they tap it.)

Until Meta approves it, sends fail with a logged 🔴 (never a crash) —
exactly the same non-blocking behavior as before.

## Heads-up: your local `routes/messagesRoutes.js` doesn't match production

I pulled your latest `origin/main` to build this (confirmed: that's
what's actually running on `hostelnode.com` right now). But your local
working copy of `routes/messagesRoutes.js` (uncommitted, in your
working tree) is currently **missing the PG/Hostel chat code
entirely** — no `pg/start`, no `resolveViewer`, no Owner-notify branch;
it looks like an older, pre-Phase-2, Flatmate-only version. I didn't
touch it and don't know if that's an intentional revert you're
mid-testing or something that happened by accident — worth checking
with `git diff origin/main -- routes/messagesRoutes.js` before you do
anything else in that file. The `routes/messagesRoutes.js` in this zip
is built on top of the live `origin/main` version (the one with PG
chat in it), not your local one — pasting it in will restore the full
PG chat code if your local copy really is missing it.

## Where each file goes (main HostelNode.com repo)

```
utils/pgConversation.js        → new file
utils/ownerNotifications.js    → replace
routes/messagesRoutes.js       → replace (only if your local copy is the reverted one — see above; if you're not sure, check the diff first)
routes/studentRoutes.js        → replace
```

## After copying these in

```
node --check routes/studentRoutes.js
node --check routes/messagesRoutes.js
```

then restart. Test: submit "Schedule Physical Visit" as a student →
check it now shows up as a message in the Owner's `/user/messages`
inbox. Send a real chat message → check the WhatsApp template send
(once approved) includes your name/phone/message, not just your name.
