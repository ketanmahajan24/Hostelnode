// ================= notificationsRoutes.js =============================
/* ============================================================
   notificationsRoutes.js — HostelNode notification bell
   Notification documents have been written since Phase 4 (connection
   accepted/declined, new message) — this is the first UI surfacing
   them. Kept deliberately separate from Messages, per the spec's own
   "Notifications = alerts, Messages = source of truth" distinction.
============================================================ */

const express = require("express");
const router  = express.Router();
const jwt     = require("jsonwebtoken");

const Notification = require("../models/Notification");

function requireStudent(req, res, next) {
  const token = req.cookies?.studentToken;
  if (!token) return res.status(401).json({ success: false, error: "Not logged in." });
  try {
    req.student = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "Session expired." });
  }
}

/* GET /notifications — recent 20 + unread count, for the navbar bell dropdown.
   Returns 200 with an empty/zero payload for a logged-out visitor rather than
   401, so the bell can simply render nothing instead of surfacing an error. */
router.get("/", async (req, res) => {
  try {
    const token = req.cookies?.studentToken;
    if (!token) return res.json({ success: true, unreadCount: 0, notifications: [] });

    let studentId;
    try {
      studentId = jwt.verify(token, process.env.JWT_SECRET).id;
    } catch {
      return res.json({ success: true, unreadCount: 0, notifications: [] });
    }

    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ user: studentId }).sort({ createdAt: -1 }).limit(20).lean(),
      Notification.countDocuments({ user: studentId, isRead: false }),
    ]);

    res.json({
      success: true,
      unreadCount,
      notifications: notifications.map((n) => ({
        _id: n._id.toString(), type: n.type, title: n.title, body: n.body,
        link: n.link, isRead: n.isRead, createdAt: n.createdAt,
      })),
    });
  } catch (err) {
    console.error("Notifications list error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

/* POST /notifications/:id/read */
router.post("/:id/read", requireStudent, async (req, res) => {
  try {
    await Notification.updateOne(
      { _id: req.params.id, user: req.student.id },
      { $set: { isRead: true, readAt: new Date() } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

/* POST /notifications/read-all */
router.post("/read-all", requireStudent, async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.student.id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

module.exports = router;
