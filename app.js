require('dotenv').config() //env variable
const LoalStrategy=require('passport-local').Strategy

const express= require("express")
const app = express();
const bodyParser = require("body-parser");
const methodOverride = require('method-override');



const cookieParser = require('cookie-parser');
const cors = require('cors');  // ✅ Import CORS
const findHostelsRouter = require("./routes/findHostels-route"); // your route file name
app.use("/findHostels", findHostelsRouter);
app.use(cookieParser()); // ✅ Use cookie-parser to parse cookies


app.use(cors({
    origin: 'http://localhost:5000', // Your frontend URL
    credentials: true // ✅ Allow cookies to be sent
}));

app.use(express.json());
// """"MIDDLEWARES"""" 
const jwt = require("jsonwebtoken");
const Student = require("./models/studentSchema");
// const adminRouter = require('./routes/adminRoutes');

// ── At the top with other requires ──
// const visitorTracker = require("./Middlewares/visitorTracker");

// TO THIS (new):
const { visitorTracker, trackGpsLocation } = require("./Middlewares/visitorTracker");


// ── After app.use(express.json()) and cookie-parser, BEFORE your routes ──
app.use(visitorTracker);

// ── Mount admin routes (if not already done) ──
const adminRouter = require('./routes/adminRoutes');
app.use('/admin', adminRouter);

  
app.use(async (req, res, next) => {
  try {
    const token = req.cookies.studentToken;

    if (!token) {
      res.locals.student = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const student = await Student.findById(decoded.id);

    res.locals.student = student || null;  // 🔥 GLOBAL ACCESS
    next();

  } catch (err) {
    res.locals.student = null;
    next();
  }
});
//  '""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""





//REQUIRing MIDDLEWARES

const logRequest = require('./Middlewares/logRequest.js');  // Import middleware
const passport = require('./Middlewares/auth.js');  // Import middleware
// const captureLocation = require('./Middlewares/captureLocation.js'); // Import
const userRoutes=require('./routes/userRoutes.js')
const publicRoutes = require("./routes/public.js");
const jwtAuthMiddleware = require('./jwt.js') 
const session = require('express-session');

// set middleware for use
// app.use(logRequest);
// app.use(captureLocation);  // Apply globally (every request will log location)

// Override with POST having ?_method=PUT
app.use(methodOverride('_method'));

// DATABASE CONNECTION 

const mongoose=require("mongoose"); //require mongoDB
const connectDB = require("./config/db");
connectDB();
require('dotenv').config();
const path = require("path");
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
app.use(bodyParser.json()); // for parsing application/json

let PORT=process.env.PORT;
 
// ///////////////////////////////////////////
// SCHEMA CONNECTIN $ REQUIRE 
// ///////////////////////////////////////////
const Floor = require("./models/floor.js"); // Floor SCHEMA
const Room = require("./models/room.js"); // room SCHEMA
const Member = require("./models/member.js"); // room SCHEMA
const Payment = require("./models/payment.js"); // Payment SCHEMA
const User = require('./models/user.js'); 
const Admin = require('./models/admin.js'); 


//FEES RENEVAL //////////////////////////////////////////////////////////////////////

// app.use("/profile-image", express.static(
//   path.join(__dirname, "secure_uploads/profiles")
// ));
app.use('/student', require('./routes/studentRoutes'));
// app.use('/student-images', express.static(path.join(__dirname, '/root/secure_uploads/students')));
// app.use("/profile-image", express.static("/app/secure_uploads/profiles"));
// app.use("/listing-images", express.static("/app/secure_uploads/listings"));

// Base upload folder (single source of truth)
const UPLOAD_BASE = '/secure_uploads';

// Static routes

app.use('/student-images', express.static(path.join(UPLOAD_BASE, 'students')));
app.use('/profile-image', express.static(path.join(UPLOAD_BASE, 'profiles')));
app.use('/listing-images', express.static(path.join(UPLOAD_BASE, 'listings')));

app.use(session({
    secret: 'mysecretkey',   // kuch bhi string
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // true only in HTTPS
}));
const cron = require("node-cron");
const moment = require("moment");
// const Member = require("./models/Member");  
// const Payment = require("./models/Payment");  
// const Room = require("./models/Room"); // Import Room model
// const { sendWhatsAppOTP } = require("./models/whatsappBaileys.js");
// const startWhatsApp = require("./models/whatsappBaileys.js").startWhatsApp;
// startWhatsApp();
// Run every day at midnight (00:00)
cron.schedule("0 0 * * *", async () => {
  console.log("🔄 Running Monthly Fee Check at 12:00 PM...");
     
    try {
        const today = moment().startOf("day"); // Get today's date
        const members = await Member.find({ status: "Active" }); // Get all members

        for (let member of members) {
            const joiningDate = moment(member.joiningDate).startOf("day");

            // ✅ Check if today matches the joining date of any month
            if (joiningDate.date() === today.date()) {
                console.log(`✅ Generating fees for: ${member.name}`);

                // ✅ Step 1: Find the assigned room
                const room = await Room.findById(member.assignedRoom_id); 
                if (!room) {
                    console.log(`❌ Room not found for ${member.name}`);
                    continue;
                }

                // ✅ Step 2: Create a new payment record with room fees
                const newPayment = new Payment({
                    memberId: member._id,
                    roomId: room._id,
                    roomFees: room.room_fees, // Fetch fee from the room
                    totalFees: room.room_fees, // Full month fee
                    advancedPaid: 0,
                    amountPaid: 0,
                    dueAmount: room.room_fees, // Due amount
                    status: "Due",
                    paymentDate: new Date() // Today's date
                });

                await newPayment.save();
                member.payments.push(newPayment._id); // Link payment to member
                await member.save();

                console.log(`💰 New Payment Added for ${member.name} on ${today.format("YYYY-MM-DD")}`);
            }
        }

    } catch (err) {
        console.error("❌ Error in Monthly Fee Processing:", err);
    }
});

// ////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  

const ejsMate=require("ejs-mate");//require ejs-Mate for boilerplate

 
app.set("view engine","ejs");

app.set("views",path.join(__dirname,"views"));
app.use(express.static(path.join(__dirname,"public")));
app.engine("ejs",ejsMate);
// app.get("/",(req,res)=>{
//     res.send("Rot is working");
// });

app.use('/user', userRoutes);
app.use('/', publicRoutes);
// Middleware
app.use(express.json());
app.use(cookieParser());

// app.use(passport.initialize());
// const localAuthMiddleware = passport.authenticate('local', { session: false });
 

// app.use(new LocalStrategy(async (username,password)))
//Part-1 Render 1st home Page- """Dashboard"""////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////// from dashboaard.ejs ////////////////////////////////////////////////////////
// app.get("/",async(req,res)=>{
//   // const { username, password } = req.query;
//   // console.log(username,password);
// //   res.send("user");
// res.render("lendingPage.ejs")
// });  

// ADD THIS LINE (after your express setup):
app.post("/track-location", trackGpsLocation);
////////////// """"Signup""""""//""""Login""""/////////////////////////////////////

//""""""""""""""""""Signup""""""""""""""""""/////////////////////////////
app.get("/signup",(req,res)=>{
  res.render("authPrivate/signup.ejs");
})
app.get("/login",(req,res)=>{
  res.render("authPrivate/login.ejs");
})

app.get("/loginforadmin",(req,res)=>{
    res.render("authPrivate/login-admin.ejs");
  })
  





// FLOORS////////////////////////////////////////////////////////////////////////////////////////////////
    // // View all Floors
    // app.get("/floors",async(req,res)=>{
    //   const allFloors= await Floor.find({}); 
    //   // console.log(user);
    //   res.render("showPage/floors/floor.ejs",{allFloors});
    // })
   
// // Taking input values from newFloor // route ->{"/admin/students/new"}
// app.post("/newfloor", async (req, res) => {
//     try {
//       const { floor_name } = req.body.floor;
//       // console.log(floor_name);


//        // 🔎 Check if a floor with the same name already exists
//     const existingFloor = await Floor.findOne({floor_name : floor_name});
//     if (existingFloor){
//       return res.status(400).send(`<h1> ${floor_name} floor with this name already exists.</h1>`);
//     }
//       // Create a new student with the data from the request body
//       const newFloor = new Floor(req.body.floor);

//       // Attempt to save the student to the database
//       await newFloor.save();
    
//       // If successful, redirect to the students list page
//       res.redirect("/floorS");
//       console.log("New Floor Added:", newFloor);
//     } catch (error){
//       // Log the error to the console for debugging
//       console.error("Error saving blog:", error);
    
//       // Check if the error is a MongoDB duplicate key error
//       if (error.code === 11000) {
//         // Duplicate key error (for example, unique constraint on a field like prn)
//         res.status(400).send("Error: Duplicate entry detected. Please ensure unique values for unique fields.");
//       } else if (error.name === "ValidationError"){
//         // Mongoose validation error
//         res.status(400).send("Validation Error: " + error.message);
//       } else {
//         // General server error for other unexpected issues
//         res.status(500).send("An unexpected error occurred. Please try again later.");
//       }
//     }
//   });

    // //Manage all Floor
    // app.get("/managefloor", async (req,res)=>{ 
    //     const allFloors= await Floor.find({}); 
    //     res.render("showPage/floors/managefloor.ejs",{allFloors});
    // })
    // //Add New Floor
    // app.get("/newfloor",(req,res)=>{
    //     res.render("showPage/floors/newFloor.ejs")
    // })
// ROOMS//////////////////////////////////////////////////////////////////////////////////////////////////
    // // View all Rooms 
    // app.get("/allrooms", async(req,res)=>{
    //     const allRooms= await Room.find({}); 
    //     const allFloors= await Floor.find({}); 
    //     res.render("showPage/rooms/allrooms.ejs",{allRooms,allFloors});
    // })
    
    // // Manage all Rooms
    // app.get("/managerooms",async (req,res)=>{

    //   const allRooms= await Room.find({});  


    //     res.render("showPage/rooms/managerooms.ejs",{allRooms});
    // })
     //Add New Room
    //  app.get("/newroom", async (req,res)=>{
    //     const floors= await Floor.find({}); 
    //     res.render("showPage/rooms/newRoom.ejs",{floors});
    // })

    
// // Taking input values from newFloor // route ->{"/admin/students/new"}
// app.post("/newroom", async (req, res) =>{
//     try {

//       // Create a new student with the data from the request body
//       const { floor_id,room_number,room_fees,sharing_capacity, occupied_beds } = req.body.room;

//       // const { floor_id, room_number,floor_name, sharing_capacity, occupied_beds } = req.body.room;

//        // ✅ Step 1: Find the floor by floor_id
//       const floor = await Floor.findById(floor_id);
//       if (!floor){
//         return res.status(404).send("Error: Floor not found.");
//       }
//     // const newRoom = new Room({ floor_id, floor_name, room_number, sharing_capacity, occupied_beds });
    
//     // ✅ Step 2: Create a new room with floor_name auto-filled
//       const newRoom = new Room({
//         floor_id,
//         floor_name: floor.floor_name, // Auto-fill floor_name from the floor document
//         room_number,
//         room_fees,
//         sharing_capacity,
//         occupied_beds,
//       });
    
//     // ✅ Step 3: Save the new room
//     await newRoom.save();
//       console.log("Room added:", newRoom);
//       // Update the floor's total_rooms
 
//       // Update the floor's total_rooms
//       await Floor.findByIdAndUpdate(floor_id,{
//         $inc: {
//           total_rooms: 1,
//           total_beds: newRoom.sharing_capacity
//         }
//       });
//       // If successful, redirect to the students list page
//       res.redirect("/allrooms");
//       console.log("New Room Added:", newRoom);
//       console.log(newRoom.floor_name);
//     }catch (error){
//       // Log the error to the console for debugging
//       console.error("Error saving blog:", error);
    
//       // Check if the error is a MongoDB duplicate key error
//       if (error.code === 11000) {
//         // Duplicate key error (for example, unique constraint on a field like prn)
//         res.status(400).send(`<h1> this room with this name already exists.</h1>`);
//         console.log(`<h1> ${room_number}th room with this name already exists.</h1>`);
//       } else if (error.name === "ValidationError"){
//         // Mongoose validation error
//         res.status(400).send("Validation Error: " + error.message);
//       } else {
//         // General server error for other unexpected issues
//         res.status(500).send("An unexpected error occurred. Please try again later.");
//       }
//     }
//   });
 
// BEDS//////////////////////////////////////////////////////////////////////////////////////////////////
//     //  Assing Bed to Room
//     app.get("/createbeds",(req,res)=>{
//         res.render("showPage/rooms/createBed.ejs")
//     })
//     app.get("/allbeds",(req,res)=>{
//         res.render("showPage/allbeds.ejs")
//     })
//     app.get("/avlbleBeds",(req,res)=>{
//     res.render("showPage/availablebeds.ejs");
// })
// // MEMBERS //////////////////////////////////////////////////////////////////////////////////////////////////
//     // View all Members
//     app.get ("/members",async (req,res)=>{
//       const members = await Member.find().populate('payments');
//       console.log(members);
//       res.render("showPage/memberData/Allmember.ejs", { allMembers: members });
//     }) 
//     //////////////////////////////////////////////////////////////////////////
// // MEMBER Edit by ._id/
// // MEMBER Edit by _id
// app.get("/member-edit/:id/edit",async (req, res) => {
//   try {
//       const { id } = req.params;

//       // Fetch all rooms (in case you want to allow room reassignment during edit)
//       const rooms = await Room.find({});

//       // Find member by ID and populate payments
//       const member = await Member.findById(id).populate('payments');

//       if (!member) {
//           return res.status(404).send("Member not found");
//       }

//       // Render edit page with member and rooms data
//       res.render("showPage/memberData/Edit-Allmember.ejs", { allMembers: member, rooms });

//   } catch (error) {
//       console.error("❌ Error loading member edit page:", error);
//       res.status(500).send("Server Error: Unable to load member edit page.");
//   }
// });

// //UPDATE ROUTE
// // UPDATE MEMBER ROUTE
// app.put("/member-edit/:id", async (req, res) => {
//   try {
//       const {id} = req.params;

//       // Find and update the member using spread to safely update nested data
//       const updatedMember = await Member.findByIdAndUpdate(id,{ ...req.body.member },{ new: true });

//       if (!updatedMember) {
//           return res.status(404).send("Member not found");
//       }

//       console.log("✅ Member updated successfully:", updatedMember);

//       // You can redirect to a success page or back to member list
//       // res.redirect(`/members/${id}`);  // Adjust based on your frontend structure
//       res.send("updated")

//   } catch (error) {
//       console.error("❌ Error updating member:", error);
//       res.status(500).send("Server Error: Unable to update member.");
//   }
// });

// // //DELETE ROUTE
// app.delete("/member/:id",async(req,res)=>{
//   let {id}=req.params;

//   const member = await Member.findById(id);
//   let deletemember= await Member.findByIdAndDelete(id);
//   // console.log(deletedMember);
  
//   const room = await Room.findById(member.assignedRoom_id);
//   if (!room) return res.status(404).send("Error: ROOM not found.");

// // Update the floor's -1 total_rooms
// await Room.findByIdAndUpdate(member.assignedRoom_id, { $inc: {occupied_beds: -1 } });
// //  console.log(room)
// // Update the floor's total_rooms
// await Floor.findByIdAndUpdate(room.floor_id, { $inc: { active_number: -1,occupied_beds:-1 } });

 
//   res.redirect("/members");
// })

// // DELETE FLOOR /////////////////////////////////////////
// // //DELETE ROUTE
// app.delete("/managefloor/:id",async(req,res)=>{
//   let {id}=req.params;
//   const floor = await Floor.findById(id);
//   let deletefloor= await Floor.findByIdAndDelete(id);
//   // console.log(deletedMember);
  
//   res.redirect("/managefloor");
// })


 
///////////////////////////    EDIT ROOM    //////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////
// app.get("/managerooms/:id/edit",async(req,res)=>{
//   let {id}=req.params;
//   const room = await Room.findById(id); 
//   console.log(room);
//   res.render("showPage/rooms/Edit-Room.ejs",{room});
// })

// // PUT route to update room details
// app.put("/manageroom/:id", async (req, res) => {
//   const { id } = req.params;z

//   const room = await Room.findById(id); 
//   console.log(room.sharing_capacity);

//   await Floor.findByIdAndUpdate(room.floor_id, { $inc: {total_beds:-room.sharing_capacity} });

//   const { room_fees, sharing_capacity }= req.body.room;

//  console.log(sharing_capacity)
//  await Floor.findByIdAndUpdate(room.floor_id, { $inc: {total_beds:sharing_capacity} });
//   try {
//       const updatedRoom = await Room.findByIdAndUpdate(id,{
//           room_fees,
//           sharing_capacity
//       });
      

//       res.redirect("/managerooms");  // Redirect after update
//   } catch (error) {
//       console.error("Error updating room:", error);
//       res.status(500).send("Failed to update room details.");
//   }
// });

 


// // //DELETE ROOM
// app.delete("/managerooms/:id",async(req,res)=>{
//   let {id}=req.params; 
//   const room = await Room.findById(id);
//   let deleteroom= await Room.findByIdAndDelete(id);
//   // console.log(deletedMember);
   
// // Update the floor's -1 total_rooms
// // await Room.findByIdAndUpdate(member.assignedRoom_id, { $inc: {occupied_beds: -1 } });
//  console.log(room)
// // Update the floor's total_rooms
//       await Floor.findByIdAndUpdate(room.floor_id,{ $inc: {total_rooms: -1,
//         occupied_beds:-room.occupied_beds,
//         total_beds:-room.sharing_capacity,
//         // occupied_beds,
//         active_number: -room.occupied_beds,
//       } });

//       if (room.sharing_capacity === room.occupied_beds) {
//         console.log(room.occupied_beds);
//         console.log("************************** Room Fulled *****************************");
//         await Floor.findByIdAndUpdate(room.floor_id, { $inc: { occupied_rooms: -1 } });
        
//       } else {
//         console.log(room.occupied_beds);
//         console.log("************************** Room Not Fulled *****************************");
//       }
//       res.redirect("/managerooms");
// })

//     //View Active Members 
//     app.get("/activeMember",async(req,res)=>{
//       const allMembers=await Member.find({});  
//       res.render("showPage/memberData/activeMember.ejs",{allMembers});
//     }) 

//     // UPDATE MEMBER STATUS TO INACTIVE // WEHEN WE CLICK THE **LEFT** BUTTON THEN STATUS WILL BE CHANGE TO INACTIVE ////////////////////////////////////////////////////////////////////////
// app.get("/activeMember/:id", async (req, res) => {
//   const { id } = req.params;
//   try {
//     // 1️⃣ Find the Member
//     const member = await Member.findById(id);
//     if (!member) {
//       return res.status(404).send("Member not found.");
//     }
//     // 2️⃣ Update Member Status to "Inactive"
//     member.status = "Inactive";
//     member.leftDate = new Date(); // Optional: Track when the member left

//     // 3️⃣ Save the Updated Member Document
//     await member.save();


//     const room = await Room.findById(member.assignedRoom_id);
//     if (!room) return res.status(404).send("Error: ROOM not found.");
  
//   // Update the floor's -1 total_rooms
//   await Room.findByIdAndUpdate(member.assignedRoom_id, { $inc: {occupied_beds: -1 } });
//   //  console.log(room)
//   // Update the floor's total_rooms
//   await Floor.findByIdAndUpdate(room.floor_id, { $inc: { active_number: -1,occupied_beds:-1 } });
 
 
    
//     // ✅ Redirect or Respond
//     res.redirect("/members"); // Redirect to members list or member details page
//   } catch (error) {
//     console.error("Error updating member status:", error);
//     res.status(500).send("Internal Server Error");
//   }
// });
// // 

 


//     // Add New Member
//     app.get("/newmember",async(req,res)=>{
//       const rooms= await Room.find({});
//         const floors= await Floor.find({});
//         res.render("showPage/memberData/newmember.ejs",{rooms,floors});
//     })
//      // Taking input values from student-new.ejs // route ->{"/admin/students/new"}
//      app.post("/newMember", async (req, res) => {
//       try {
//         const { assignedRoom_id,name, fatherName, mobileNo, aadharNo, address, profession, joiningDate } = req.body.member;
//         // const { totalFees, amountPaid, paymentMode, payableDate } = req.body.payment;
//         // ✅ Step 1: Find the room
//         const room = await Room.findById(assignedRoom_id);
//         if (!room) return res.status(404).send("Error: ROOM not found.");
//         // ✅ Step 2: Create new member
//         const newMember = new Member({
//           assignedRoom_id,
//           name,
//           fatherName,
//           mobileNo,
//           aadharNo,
//           address,
//           profession,
//           joiningDate,
//           assignedRoom: room.room_number,
//           status: "Inactive",
//         });
    
//         // ✅ Step 3: Calculate due amount
//         // const dueAmount = totalFees - amountPaid;
    
//         // ✅ Step 4: Create new payment
//         const newPayment = new Payment({
//           memberId: newMember._id,
//           roomId: assignedRoom_id,
//           roomFees:room.room_fees,
//         });
//         console.log(room.floor_id);

//        // ✅ Step 5: Save payment and push reference to member

//         //if beds are fully 
//        if( room.sharing_capacity==room.occupied_beds){
//         console.log("BEDS ARE NOT Available");
//         res.send("IN THIS ROOM ALL BEDS ARE ALREADY OCCUPIED ")
//        }else{
        
//         await newPayment.save();
//         newMember.payments.push(newPayment._id);
//         // ✅ Step 6: Save member
//         await newMember.save();
           
//       res.redirect("/newAdded/succesfully");
//       console.log("✅ New member and payment added:",newMember, newPayment);
//       console.log(room.occupied_beds);
//           if (room.sharing_capacity === room.occupied_beds + 1) {
//             console.log(room.occupied_beds);
//             console.log("************************** Room Fulled *****************************");
//             await Floor.findByIdAndUpdate(room.floor_id, { $inc: { occupied_rooms: 1 } });
            
//           } else {
//             console.log(room.occupied_beds);
//             console.log("************************** Room Not Fulled *****************************");
//           }
//        // Update the floor's total_rooms
//        await Room.findByIdAndUpdate(assignedRoom_id, { $inc: {occupied_beds: 1 } });
//        // console.log("Room added:", newRoom);
//        // Update the floor's total_rooms
//        await Floor.findByIdAndUpdate(room.floor_id, { $inc: { active_number: 1,occupied_beds:1 } });
//        // console.log("Room added:", newRoom);
      
//       }
     
//       } catch (error) {
//           console.error("❌ Error saving member:",error);
//           res.send("<H1>DUPLICATE VALUE</H1>");
//       }
//     });

//     app.get("/newAdded/succesfully",(req,res)=>{
//       res.render("showPage/memberData/newmemberADDED.ejs");
//     })
    
 
 

// // ADD PAYMENT TO PARTICULAR MEMBER                         
// app.get("/members/:id/addpayment", async (req, res) => {
//   const {id} = req.params;
//   try {
//     const member = await Member.findById(id).populate('payments');
//     if (!member) return res.status(404).send("Error: Member not found.");
//     // ✅ Calculate total fee

//     const totalFees = member.payments.reduce((sum, payment) => sum + (payment.roomFees || 0), 0);

//     // Sum of all amountPaid from payments
//     const amountPaid = member.payments.reduce((sum, payment) => sum + (payment.amountPaid || 0), 0);

//     // Calculate dueAmount based on totalFees
//     const dueAmount = amountPaid >= totalFees ? 0 : totalFees - amountPaid;

 
//     // const totalFee = member.payments.reduce((sum,payment) => sum + payment.totalFees, 0)
//     res.render("payments/addpayment.ejs", {member,dueAmount});
//   } catch (err){
//     console.error("Error fetching member:", err);
//     res.status(500).send("Server Error");
//   }
// });
// // ADD PAYMENT ENTRY /////////////////////////////////////////////////////
// app.post("/addpayment/:id", async (req, res) => {
//   const { id } = req.params;
//   const { amountPaid, paymentMode, paymentDate } = req.body.payment;

//   try {
//     const member = await Member.findById(id);
//     if (!member){
//       return res.status(404).send("Member not found.");
//     }
//     const newPayment = new Payment({
//       memberId: id,
//       amountPaid,
//       paymentMode,
//       paymentDate,
//     });

//     const savedPayment = await newPayment.save();

//     member.payments.push(savedPayment._id);
//     member.status = "Active";
//     member.leftDate ="";
//     await member.save();
//     // ✅ Instead of rendering, redirect to the GET receipt route
//     res.redirect(`/payment-receipt/${savedPayment._id}`);
//   } catch (error) {
//     console.error("Error adding payment:", error);
//     res.status(500).send("Internal Server Error");
//   }
// });
// app.get("/payment-receipt/:paymentId", async (req, res) => {
//   const { paymentId } = req.params;

//   try {
//     const payment = await Payment.findById(paymentId);
//     if (!payment) {
//       return res.status(404).send("Payment not found.");
//     }

//     const member = await Member.findById(payment.memberId);
//     if (!member) {
//       return res.status(404).send("Member not found.");
//     }

//     // ✅ Render Payment Receipt Page from GET Route
//     res.render("payments/paymentreciept.ejs", {
//       member,
//       payment,
//     });
//   } catch (error) {
//     console.error("Error loading payment receipt:", error);
//     res.status(500).send("Internal Server Error");
//   }
// });

// // SEARCH MEMBER /////////////////////////////////////////////////////////////////////////

// // Route to handle search by mobile or name
// app.post("/member/search", async (req, res) => {
//   try {
//     let searchQuery = req.body.name; // Taking input from request

//     // Searching members by name or mobile number (case-insensitive)
//     const members = await Member.find({
//       $or: [
//         { name: { $regex: searchQuery, $options: "i" } }, // Search by name
//         { mobileNo: searchQuery } // OR search by exact mobile number
//       ]
//     }).populate('payments');

//     // If no matching member is found
//     if (members.length === 0) {
//       return res.render("showPage/memberData/searchedNotFoundMember.ejs", { 
//         errorMessage: "Member NOT FOUND" 
//       });
//     }

//     // If member(s) found, render the search results page
//     res.render("showPage/memberData/searchedMember.ejs", { allMembers: members });

//   } catch (error) {
//     console.error("Error searching for member:", error);

//     if (error.code === 11000) {
//       res.status(400).send("Error: Duplicate entry detected. Please ensure unique values for unique fields.");
//     } else if (error.name === "ValidationError") {
//       res.status(400).send("Validation Error: " + error.message);
//     } else {
//       res.status(500).send("An unexpected error occurred. Please try again later.");
//     }
//   }
// });
  
// // PAYMENT STRUCTURE

// // SHOW ALL FEES RECORDR TO allrecords.ejs
// app.get("/allfeesrecords", async (req, res) => {
//   try {
//     const allMembers = await Member.find({})
//       .populate("payments") // Populate payment details
//       .exec();

//     const membersWithFees = allMembers.map((member) => {
//       // Sum of all roomFees from payments
//       const totalFees = member.payments.reduce((sum, payment) => sum + (payment.roomFees || 0), 0);

//       // Sum of all amountPaid from payments
//       const amountPaid = member.payments.reduce((sum, payment) => sum + (payment.amountPaid || 0), 0);

//       // Calculate dueAmount based on totalFees
//       const dueAmount = amountPaid >= totalFees ? 0 : totalFees - amountPaid;
//       const advancedPaid = amountPaid > totalFees ? amountPaid - totalFees : 0;

//       return {
//         ...member.toObject(),
//         totalFees,
//         advancedPaid,
//         amountPaid,
//         dueAmount,
//       };
//     });
    
//     res.render("payments/allrecords.ejs", { allMembers: membersWithFees });
//   } catch (err) {
//     console.error("Error fetching records:", err);
//     res.status(500).send("Internal Server Error");
//   }
// });

// // search fees record of member
// // SEARCH FEES RECORDS BASED ON MEMBER NAME OR MOBILE NUMBER
// app.post("/searchfeesrecords", async (req, res) => {
//   try {
//     const searchQuery = req.body.searchQuery; // input from form (name or mobile number)

//     const filteredMembers = await Member.find({
//       $or: [
//         { name: { $regex: searchQuery, $options: "i" } }, // Case-insensitive name search
//         { mobileNo: searchQuery } // Exact match for mobile number
//       ]
//     }).populate("payments");

//     const membersWithFees = filteredMembers.map((member) => {
//       // Calculate totalFees (sum of roomFees)
//       const totalFees = member.payments.reduce((sum, payment) => sum + (payment.roomFees || 0), 0);

//       // Calculate amountPaid (sum of amountPaid)
//       const amountPaid = member.payments.reduce((sum, payment) => sum + (payment.amountPaid || 0), 0);

//       // Calculate dueAmount and advancedPaid
//       const dueAmount = amountPaid >= totalFees ? 0 : totalFees - amountPaid;
//       const advancedPaid = amountPaid > totalFees ? amountPaid - totalFees : 0;

//       return {
//         ...member.toObject(),
//         totalFees,
//         advancedPaid,
//         amountPaid,
//         dueAmount,
//       };
//     });

//     if (membersWithFees.length === 0) {
//       return res.render("payments/allrecordsNotFound.ejs", {
//         allMembers: [],
//         errorMessage: "No records found for the search query.",
//       });
//     }

//     res.render("payments/allrecords.ejs", {
//       allMembers: membersWithFees,
//       errorMessage: null,
//     });
//   } catch (err) {
//     console.error("Error searching fee records:", err);
//     res.status(500).send("Internal Server Error");
//   }
// });


// /////////////////////////////////////////////////////////////////////////////
// ////////////////////////////////////////////////////////////////////////////////////////////
// app.get('/payment-history/:memberId', async (req, res) => {
//   const memberId = req.params.memberId;
//   try {
//     const member = await Member.findById(memberId);
//     const payments = await Payment.find({ memberId }).sort({ paymentDate: -1 });
//     res.render('payments/PaymentHistoryOfOne.ejs', { member, payments });
//   } catch (err) {
//     console.error(err);
//     res.status(500).send('Server Error');
//   }
// });

 

// // ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// // UPCOMING PAYMENTS///////////////////
// app.get("/upcomingPayments", async (req, res) => {
//   try {
//     const today = new Date();
//     const upcomingDays = [];

//     // Generate day numbers for the next 5 days
//     for (let i = 0; i <= 5; i++) {
//       const date = new Date(today);
//       date.setDate(today.getDate() + i);
//       upcomingDays.push(date.getDate());
//     }

//     const members = await Member.find().populate('payments');

//     // Filter members whose joining day matches any of the upcoming days
//     const upcomingPayments = members.filter(member => {
//       const joiningDay = new Date(member.joiningDate).getDate();
//       return upcomingDays.includes(joiningDay);
//     });

//     res.render("payments/upcomingPayments.ejs", { allMembers: upcomingPayments });
//   } catch (err) {
//     console.error("Error fetching upcoming payments:", err);
//     res.status(500).send("Internal Server Error");
//   }
// });
// //SHOW DUE AMOUNT//////////////////////////////////////



// app.get("/deureports",async(req,res)=>{
 

// try {
//   const allMembers = await Member.find({})
//     .populate("payments") // Populate payment details
//     .exec();

//   const membersWithFees = allMembers.map((member) => {
//     // Sum of all roomFees from payments
//     const totalFees = member.payments.reduce((sum, payment) => sum + (payment.roomFees || 0), 0);

//     // Sum of all amountPaid from payments
//     const amountPaid = member.payments.reduce((sum, payment) => sum + (payment.amountPaid || 0), 0);

//     // Calculate dueAmount based on totalFees
//     const dueAmount = amountPaid >= totalFees ? 0 : totalFees - amountPaid;
//     const advancedPaid = amountPaid > totalFees ? amountPaid - totalFees : 0;

//     return {
//       ...member.toObject(),
//       totalFees,
//       advancedPaid,
//       amountPaid,
//       dueAmount,
//     };
//   });

//   res.render("payments/duesReport.ejs", { allMembers: membersWithFees });
// } catch (err) {
//   console.error("Error fetching records:", err);
//   res.status(500).send("Internal Server Error");
// }

// })






 
app.post('/admin-login', async (req, res) => {
    try {
        const { username, password } = req.body.admin;

        // Find the admin by username
        const admin = await Admin.findOne({ username: username });

        if (!admin) {
            return res.render("authPrivate/login-admin.ejs", { error: "Invalid username or password" });
        }

        // Check if account is active
        if (admin.status !== "Active") {
            return res.render("authPrivate/login-admin.ejs", { error: "Account is inactive. Contact support." });
        }

        // Compare entered password with stored password
        if (password !== admin.password) {
            return res.render("authPrivate/login-admin.ejs", { error: "Invalid Password " });
        }

        // Successful login, redirect to admin dashboard
        // res.redirect('/ketanmahajan2408');
        const users = await User.find(); // Fetch all users
        const isadmin = await Admin.findOne({ username: username }); // Replace with actual logic
       
        res.render("superAdmin/admin", { users,isadmin}); // Pass users to EJS template

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

//Toggle user status (Active → Inactive)
app.put("/dashboard/:id", async (req, res) => {
    try {
        const userId = req.params.id;

        // Find the user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Toggle status
        const newStatus = user.status === "Active" ? "Inactive" : "Active";

        // Update status in the database
        await User.findByIdAndUpdate(userId, { status: newStatus });

        // Redirect back to dashboard
        // res.redirect("#")
    //    res.render("superAdmin/admin", { users,isadmin}); // Pass users to EJS template
    res.send("STATUS IS UPDATED")

    } catch (error) {
        console.error("Error updating status:", error);
        res.status(500).send("Error updating user status");
    }
});
 



// ////////////////////////////////////////////////////////////////////////////////////////////
// ////////////////////////////////////////////////////////////////////////////////////////////
// finding hostels page-----------------------------------------------------------------------------------------------------------------------------//////////////

// FINDING Hostels 
// app.get("/findHostels",async(req,res)=>{
//   // const { username, password } = req.query;
//   // console.log(username,password);
// //   res.send("user");
// res.render("./listings/findHostels.ejs")
// });  

 











app.listen(PORT,()=>{
    console.log(`Server is Listening on port ${PORT}`);
});