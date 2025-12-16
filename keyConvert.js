const fs = require('fs');
const key = fs.readFileSync('./decoration-booking-system-firebase-adminsdk-fbsvc-81831d7ef6.json', 'utf8')
const base64 = Buffer.from(key).toString('base64')
console.log(base64)