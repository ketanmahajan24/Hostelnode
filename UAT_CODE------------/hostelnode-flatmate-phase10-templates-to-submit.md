# Phase 10 — WhatsApp templates to submit in Meta WhatsApp Manager

All 7 are **Utility** category (transactional reminders/alerts about the user's
own account activity — not promotional). Submit each as **English (US)**
(`en_US`) to match every code default below. If Meta's UI only offers plain
**English** (`en`) for your account, that's fine too — just set the matching
`_LANG` env var to `en` so the code and Meta agree (see Phase 9's writeup for
why a mismatch causes error 132001).

For each: create the template in WhatsApp Manager → Account tools → Message
templates → Create template, using the exact **name** below, the **body**
text with `{{1}}`, `{{2}}` etc. as shown, and Category = **Utility**. Once
Meta approves it, set the matching env var (or leave unset to use the literal
fallback name, which already matches).

---

### 1. Pending request reminder
- **Template name:** `hostelnode_flatmate_pending_reminder`
- **Env var (name):** `WA_TEMPLATE_FLATMATE_PENDING_REMINDER` (fallback: literal name above)
- **Env var (language):** `WA_TEMPLATE_FLATMATE_PENDING_REMINDER_LANG` (default: `en_US`)
- **Variables:** 2 — `{{1}}` requester's first name, `{{2}}` listing summary
- **Body:**
  > Reminder: {{1}} is still waiting on your flatmate request for {{2}}. Reply soon so they don't miss out — open HostelNode to respond.

### 2. Unread message reminder
- **Template name:** `hostelnode_flatmate_unread_reminder`
- **Env var (name):** `WA_TEMPLATE_FLATMATE_UNREAD_REMINDER`
- **Env var (language):** `WA_TEMPLATE_FLATMATE_UNREAD_REMINDER_LANG` (default: `en_US`)
- **Variables:** 0
- **Body:**
  > You have an unread message on HostelNode. Open the app to reply before the conversation goes cold.

### 3. New matching listing alert
- **Template name:** `hostelnode_flatmate_new_match`
- **Env var (name):** `WA_TEMPLATE_FLATMATE_NEW_MATCH`
- **Env var (language):** `WA_TEMPLATE_FLATMATE_NEW_MATCH_LANG` (default: `en_US`)
- **Variables:** 1 — `{{1}}` listing summary (e.g. "2 BHK · Kothrud, Pune")
- **Body:**
  > A new listing matches your saved search: {{1}}. Open HostelNode to view it before someone else connects.

### 4. Listing expiring soon
- **Template name:** `hostelnode_flatmate_expiring_soon`
- **Env var (name):** `WA_TEMPLATE_FLATMATE_EXPIRING_SOON`
- **Env var (language):** `WA_TEMPLATE_FLATMATE_EXPIRING_SOON_LANG` (default: `en_US`)
- **Variables:** 1 — `{{1}}` listing summary
- **Body:**
  > Your listing ({{1}}) will expire soon on HostelNode. Open the app to renew it and keep it visible to flatmate seekers.

### 5. Listing expired (auto-closed)
- **Template name:** `hostelnode_flatmate_expired`
- **Env var (name):** `WA_TEMPLATE_FLATMATE_EXPIRED`
- **Env var (language):** `WA_TEMPLATE_FLATMATE_EXPIRED_LANG` (default: `en_US`)
- **Variables:** 1 — `{{1}}` listing summary
- **Body:**
  > Your listing ({{1}}) has expired and is no longer visible on HostelNode. Republish it anytime from My Listings.

### 6. Listing milestone (views)
- **Template name:** `hostelnode_flatmate_milestone`
- **Env var (name):** `WA_TEMPLATE_FLATMATE_MILESTONE`
- **Env var (language):** `WA_TEMPLATE_FLATMATE_MILESTONE_LANG` (default: `en_US`)
- **Variables:** 2 — `{{1}}` the milestone count (e.g. "50"), `{{2}}` listing summary
- **Body:**
  > Your listing ({{2}}) just crossed {{1}} views on HostelNode! Check your requests — interested flatmates may be waiting to connect.

### 7. Re-activate reminder (long-paused listing)
- **Template name:** `hostelnode_flatmate_reactivate_reminder`
- **Env var (name):** `WA_TEMPLATE_FLATMATE_REACTIVATE_REMINDER`
- **Env var (language):** `WA_TEMPLATE_FLATMATE_REACTIVATE_REMINDER_LANG` (default: `en_US`)
- **Variables:** 1 — `{{1}}` listing summary
- **Body:**
  > Your listing ({{1}}) has been paused for a while on HostelNode. Reactivate it whenever you're ready to start receiving requests again.

---

## Env vars for the two new Phase 10 timing windows (optional — all have working defaults)

| Env var | Default | Meaning |
|---|---|---|
| `FLATMATE_PENDING_REMINDER_HOURS` | `24` | Hours a request can sit pending before the owner gets nudged |
| `FLATMATE_UNREAD_REMINDER_HOURS` | `3` | Hours a message can sit unread before the recipient gets nudged |
| `FLATMATE_EXPIRY_WARNING_DAYS` | `7` | Days before `expiresAt` that the owner is warned |
| `FLATMATE_PAUSE_REMINDER_DAYS` | `7` | Days a listing can sit PAUSED before the owner gets nudged |
| `FLATMATE_LISTING_LIFETIME_DAYS` | `60` | Days a listing stays ACTIVE before auto-expiring (assumption — no spec value existed) |

## Note on the two scope decisions made under "full fill my requirement"

1. **Listing expiry (60-day default).** There was no expiry/auto-close concept
   anywhere in the schema before this. I added `expiresAt` (set whenever a
   listing becomes ACTIVE, whether via admin approval or owner reactivation)
   and an hourly cron that auto-closes anything past it — reusing the
   existing `CLOSED` status rather than adding a new one, to avoid touching
   any other code that branches on listing status. 60 days is a reasonable
   starting default, not a number you specified — change it anytime via
   `FLATMATE_LISTING_LIFETIME_DAYS`, no code change needed.
2. **Saved searches (new feature).** "New matching listing alert" needed
   something to match against, and no saved-search feature existed. I built
   a minimal one: a "Save this search" button on the results page, a model,
   and a simple list page to view/remove saved searches — using the exact
   same filter fields as the results page so matching is consistent.
