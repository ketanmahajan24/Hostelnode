const axios = require('axios');
const useragent = require('useragent');
// Function to check if IP is private (local network)
// const isPrivateIp = (ip) => {
//     return ip.startsWith('192.') || ip.startsWith('10.') || ip.startsWith('127.') || ip.startsWith('::1');
// };

const captureLocation  = (req, res, next) => {
    const agent = useragent.parse(req.headers['user-agent']);

    console.log(`📱 Device Info: ${agent.toString()}`);
    console.log(`OS: ${agent.os}`);
    console.log(`Device: ${agent.device}`);
    console.log(`Browser: ${agent.family}`);

    req.deviceInfo = {
        os: agent.os.toString(),
        device: agent.device.toString(),
        browser: agent.family
    };

    next();
};

module.exports = captureLocation;
