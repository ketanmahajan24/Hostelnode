// Public.js

const express = require("express");
const router = express.Router();

// Models
// listing property schema
const Listing = require("../models/listingProperty"); 
 

router.get("/",   async (req, res) => {
  const listings = await Listing.find({
    // isActive: true, 
     status: "Approved"
  //  isApproved: true
  }).limit(24).sort({ createdAt: -1 }) // latest first;

  // console.log("Fetched Listings for Home Page:", listings);
  // console.log("Fetched Listings for Home Page:", listings.map(l => l.title)); // Log titles only
  // console.log("Home Page loaded '/' route");
  res.render("listings/findHostels", {  listings,student: res.locals.student || null });
});

 








 // ================== TEMP HOME PAGE (REPLACE WITH REAL ONE LATER) ==================
router.get("/StartManagingYourHostel",async(req,res)=>{
  // const { username, password } = req.query;
  // console.log(username,password);
//   res.send("user");
res.render("lendingPage.ejs")
}); 



router.get("/hostel/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    

    // 🔥 Increment views + get updated doc
    const listing = await Listing.findOneAndUpdate(
      { slug },
      { $inc: { views: 2 } },
      { new: true }
    ).populate("owner"); // ✅ IMPORTANT: populate owner to get name/avatar for reviews and owner info on page;

    // ❗ Handle not found
    if (!listing) {
      return res.status(404).send("Hostel not found");
    }

    console.log("UPDATED VIEWS:", listing.views); // 👈 debug

    // Check if logged-in student already reviewed
    let studentReview = null;
    if (req.student) {
      studentReview = listing.reviews.find(
        rv => rv.student?.toString() === req.student.id
      ) || null;
    }
    
    // Similar listings
    const similar = await Listing.find({
      "location.city": listing.location.city,
      _id: { $ne: listing._id }
    }).limit(4);

    res.render("listings/hostel-view.ejs", {
    hostel:listing,
    similar,
   
    // student: req.student || null,
    studentReview,            // ← null if not reviewed, object if already reviewed
    breadcrumb: true
    });

  } catch (err) {
    console.error("❌ Hostel view error:", err);
    res.status(500).send("Server Error");
  }
});















module.exports = router;