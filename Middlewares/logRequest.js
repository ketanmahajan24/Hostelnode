//Middleware function for printing LOGING TIME
const logRequest =(req,res,next)=>{
    console.log(`[${new Date().toLocaleString()}] Request Made to : ${req.originalUrl}`);
    next();//Move on to the next Phase
  }
  module.exports=logRequest;