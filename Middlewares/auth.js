const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const User = require('../models/user'); 
// username= "alicebrown789";
// password="mypassword789";

passport.use(new LocalStrategy(async (username, password, done) => {
    try {
        console.log('Received credentials:', username, password);
        const user = await User.findOne({ username });
        if (!user) {
            return done(null, false, { message: 'Incorrect username.' });
        }
        
        const isPasswordMatch = user.password === password ? true : false;
        if (isPasswordMatch)
            return done(null, user);
        else
            return done(null, false, { message: 'Incorrect password.' });
    } catch (error) {
        return done(error);
    }
}));
module.exports =passport;