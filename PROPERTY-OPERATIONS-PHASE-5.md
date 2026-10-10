# Property Operations — Phase 5: rent ledger and cash payments

There are two ZIPs, one for each site. Both were built on what is on GitHub now:
- Owner dashboard: commit e465e7e (your Phase 1 install).
- Main site: commit b55bc57.

**Both ZIPs include Phases 2, 3, 4 and 5.** If the earlier phases aren't installed yet, installing these installs them too. Their notes still apply:
- PROPERTY-OPERATIONS-PHASE-2.md: the bed recount.
- PROPERTY-OPERATIONS-PHASE-3.md: WhatsApp templates.
- PROPERTY-OPERATIONS-PHASE-4.md: Cashfree DigiLocker keys.

## Install (do it in this order)

1. **Back up the database** (mongodump, or an Atlas snapshot).
2. **Owner dashboard (manage.hostelnode.com).**
   - Unzip over the repo, keeping the same folders.
   - Stop the running app completely, then start the new one.
3. **Main site (hostelnode.com).** Unzip over the repo, then restart.
4. **Optional, once:** label the older payment entries.
   ```
   node scripts/ledger-months.js           # shows what it would label; changes nothing
   node scripts/ledger-months.js --apply   # saves the labels
   ```
   - This only saves each old entry's kind (rent or payment) and month on it.
   - No amount, date or tenant is changed, and nothing is deleted.
   - The ledger works the same without it. The labels only make sure older entries always stay in the month they were charged for.
   - Run it on the owner dashboard server, which has `MONGO_URL` in `.env`.

**Nothing old is copied or deleted.** The ledger is built from the payment entries you already have.
- Everything you see today (dues, paid, receipts, Reports) keeps the same totals.
- The one exception: entries you cancel from now on don't count anywhere.

**New fields** on payment entries (all optional): kind, month, category, note, reference, receipt number, recorded by, cancelled (when, why, by whom). No new collections are needed.

## Important change on the main site

The main site still had an **old midnight rent job** running. On each tenant's joining day it charged the room's rent, so it ignored:
- the tenant's own due day,
- the tenant's own rent, and
- India time.

The owner dashboard has charged rent correctly since Phase 1, so the old job could add the wrong amount on the wrong day. **It is now off.** Only the owner dashboard charges rent.
- If you ever need the old job back, add `HN_LEGACY_RENT_CRON=1` to the main site's `.env`.
- Check that your owner dashboard server runs all the time. It is the one that charges rent at 00:05 India time every day.

## WhatsApp receipt (optional; switch on after Meta approves the template)

The receipt PDF goes from HostelNode's WhatsApp number, the one that sends OTPs. It stays off until the template name is in the owner dashboard `.env`; until then the receipt can still be opened and downloaded.

Create the template in Meta WhatsApp Manager, with category **Utility** and language **English (en)**.

Name: `hostelnode_rent_receipt`. Header: **Document** (upload any sample PDF when Meta asks).

Body:
```
Hi {{1}}, {{2}} received {{3}} ({{4}}) on {{5}}.
For: {{6}}.
Receipt no. {{7}} is attached.
```
Samples for Meta: Karan · Sai PG Nerul · ₹8,700 · Cash · 9 Oct 2026 · September rent (balance), October rent · RC-2026-0142

When it is approved:
- Add `WA_TEMPLATE_RENT_RECEIPT=hostelnode_rent_receipt` to the owner dashboard `.env` and restart.
- The Collect panel then shows "Send the receipt to … on WhatsApp", ticked.
- Optional: if WhatsApp Manager shows a different language code, set `WA_TEMPLATE_RENT_RECEIPT_LANG`.

## Off switch

`HN_LEDGER=off` in the owner dashboard `.env` (then restart) brings back the old Payments pages, for example if something unexpected appears after going live.
- Nothing recorded with the new pages is lost.
- Remove the line to switch the new pages back on.

## What changed: owner dashboard

**Payments → Collect Payment** (`/user/payments`)
- **Numbers first:**
  - Expected this month (rent and extras).
  - Collected, with a bar and how many tenants paid.
  - Due today.
  - Overdue (past each tenant's own due day).
  - Use ‹ › to see earlier months.
- **Tabs:**
  - **Due now:** who owes, most overdue first, with what for ("Sep balance + Oct"), Call, WhatsApp reminder and Collect.
  - **Upcoming · 7 days:** rent falling due soon, and whether the tenant's advance already covers it.
  - **Collected:** every payment in the month, with date, amount, how it was paid, reference, who recorded it, the receipt number and a Receipt link. Cancelled ones are shown crossed out.
- Search by name, mobile or room.

**Collect payment.** A panel slides in from the right; on a phone it comes up from the bottom.
- The amount due is shown at the top, broken down by month.
- **Full due ₹X** fills in the whole due.
- How it was paid: Cash, UPI to you, or Bank, with a UPI or bank reference, the date received and a note.
- Every payment gets a **receipt number**, one series per owner (RC-2026-0001, RC-2026-0002 …), and **"recorded by"** with your name.
- **Payments go to the oldest unpaid month first.** Anything above the due is kept as advance and used by the next rent.
- After recording, a message shows **View receipt** and, for 10 minutes, **Undo**.
- The same payment sent twice within 15 seconds (a double tap) is recorded once.

**Tenant → Payments tab: the ledger**
- **Totals:** charged, paid, and due (or advance).
- **The security deposit** has its own line: agreed, collected (how and when), held now, or what happened to it at move-out.
- **One row per month:** charged (rent + extras), paid, balance and status (Paid, Part paid, Due today, Overdue · N days, Due on a coming date).
  - Inside each month: the rent, any extras, the payments that went to it (with receipt numbers and who recorded them) and cancelled entries, crossed out with the reason.
  - Paid months are folded; tap to open.
- **+ Add charge:**
  - Choose Electricity, Food, Laundry, Damage, Late fee, Rent or Other, with an amount, the month and a note.
  - "Rent" is for putting back a month's rent after a wrong rent entry was cancelled. A month that still has rent can't get a second one.
- **Cancel / Cancel entry:**
  - A reason is required.
  - The entry stays in the ledger, crossed out, with who cancelled it and why, and it stops counting everywhere (Tenants list, Dues, dashboard, Reports, move-out).
  - Entries made by a move-out settlement can't be cancelled; undo the move-out instead.
- **Statement PDF:** the whole ledger, month by month, over as many pages as needed.
- **Receipt PDF** for every payment, including older ones (they show as OLD-xxxxxx).

**Payments → Dues** (`/user/dues`)
- Everyone who owes, with the total at the top.
- Sort by most overdue or biggest.
- Each card shows months owed and days late, plus Call, **Remind** and Collect. Remind opens WhatsApp on your phone with the amount; nothing is sent until you send it.
- Tenants who moved out and still owe are shown as "Moved out".

**Elsewhere**
- Rent and payments added at admission get the same receipt numbers and "recorded by".
- **Old addresses open the new pages:**

  | Old page | Opens |
  |---|---|
  | Collect Payment (old list) | Payments |
  | Upcoming | Payments → Upcoming |
  | Dues | Dues |
  | Add payment | Collect |
  | Payment history | The tenant's Payments tab |
  | Old receipt page | Receipt PDF |

  An "Add payment" page still open from before the update still saves, the new way.
- **Plans:** Dues and the Upcoming tab are part of the "Dues & Upcoming" plan feature, as before. Collect Payment (with Due now and Collected) stays open on every plan, like the old Collect Payment page.
- **Monthly rent job:** an extra charge in a month doesn't stop that month's rent from being charged.

## What changed: main site
- The old midnight rent job is off (see above).
- `models/payment.js` and `utils/planGate.js` are identical to the owner dashboard's copies. They are shared files; keep them the same in both repos.
- `/user/payments` and `/user/dues` on hostelnode.com send owners to manage.hostelnode.com, like the other owner pages.
- The old owner dashboard page on hostelnode.com leaves cancelled entries out of its totals.

## Test list for UAT
1. **Payments:** the four numbers look right, all three tabs work, search finds a name, a mobile and a room, and ‹ Sep shows last month.
2. **Collect from a tenant who owes 2 months:**
   - Tap Full due, choose UPI with a reference, and record it.
   - The message shows the receipt number. View receipt opens the PDF: what it paid for, and "Still due after this ₹0".
3. **Record a part payment.** The oldest month shows "Part paid"; the next month is still due.
4. **Tap Record twice quickly.** Only one payment is saved.
5. **Add charge:** Electricity ₹420 for this month with a note. It shows in the month, and the due goes up. History has a line for it.
6. **Cancel a payment with a reason.** It stays crossed out with the reason; the due goes back up on the ledger, the Tenants list and Dues.
7. **Undo right after recording** (from the message).
8. **Statement PDF:** opens with every month.
9. **Dues:** most overdue first, then Biggest. Remind opens WhatsApp with the amount. A moved-out tenant who owes shows "Moved out".
10. **Upcoming:** a tenant whose rent day is in the next 7 days, and "Covered by advance" for one who paid ahead.
11. **Old links:** /user/allfeesrecords, /user/deureports, /user/upcomingPayments and a tenant's old "Add payment" link open the new pages.
12. **On a phone:** Payments, Dues, the Collect panel (from the bottom), the ledger and both dialogs fit the screen without sideways scrolling.
13. **If you set up the WhatsApp template:** the receipt PDF arrives on the tenant's WhatsApp.

## Tests run before delivery
- **New Phase 5 tests: 121 checks, all passing.** They cover:
  - Recording, receipt numbers, "recorded by", and oldest-month-first.
  - Part payments and double taps.
  - Extra charges and cancelling.
  - Undo.
  - Receipt and statement PDFs, including long ones.
  - Another owner unable to see or change anything (every new address tried).
  - Payments and Dues numbers.
  - Old addresses and the old form.
  - Move-out entries.
  - WhatsApp receipt (with a WhatsApp stand-in).
  - The monthly rent job.
  - 3 payments at the same moment getting 3 different receipt numbers.
  - The labelling script.
  - The off switch.
  - The main site's rent job being off.
- **Earlier suites rerun, all passing:**

  | Suite | Checks |
  |---|---|
  | Phase 4 | 96 |
  | Phase 3 | 123 |
  | Phase 2 | 95 |
  | Phase 1 | 82 |
  | Billing and plans (now also checks the new Dues and Upcoming addresses) | 106 + 167 |
  | Payments | 108 |
  | Listings and leads | 17 + 20 + 27 |
  | Admin | 44 |
  | Upgrade popup | 65 |
  | Page smoke test | 35 pages |

  A few older checks were updated where the old payment pages now open the new ones.
- **Independent code review: two rounds.** Everything found was fixed and tested again. Fixes included:
  - Advance-only payments getting Cancel and Receipt.
  - Long receipts.
  - Charges sent twice.
  - Payments of the same amount on different days.
  - Rent added twice for a month.
