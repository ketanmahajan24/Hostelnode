/* ============================================================
   utils/leadScoring.js  —  HostelNode Lead Temperature Scoring
============================================================ */

function scoreLead({ actionType, moveIn, budgetRange, message }) {
  let score = 0;

  const actionWeights = {
    schedule_visit:     4,   // physical visit — highest intent
    virtual_tour:       3,   // virtual tour — interested but remote
    whatsapp_callback:  3,
    request_callback:   2
  };
  score += actionWeights[actionType] || 1;

  const moveInWeights = {
    "Immediately":    4,
    "Within 1 week":  3,
    "Within 1 month": 2,
    "1–3 months":     1,
    "Just exploring": 0
  };
  score += moveInWeights[moveIn] ?? 1;

  if (budgetRange && budgetRange.trim()) score += 1;
  if (message && message.trim().length > 5) score += 1;

  let category = "Cold";
  if (score >= 7) category = "Hot";
  else if (score >= 4) category = "Warm";

  return { score, category };
}
 
module.exports = { scoreLead };