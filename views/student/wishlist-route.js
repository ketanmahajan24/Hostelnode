 // In your listing GET route
const listing = await Listing.findOne({ slug: req.params.slug });

// Check if logged-in student already reviewed
let studentReview = null;
if (req.student) {
  studentReview = listing.reviews.find(
    rv => rv.student?.toString() === req.student.id
  ) || null;
}

res.render("listings/listing-view.ejs", {
  listing,
  similar,
  student: req.student || null,
  studentReview,            // ← null if not reviewed, object if already reviewed
  breadcrumb: true
});