var fs = require('fs');
var env = process.env;

if (fs.existsSync('./.env.json')) {
  env = require('./.env.json');
}

module.exports = {
  "AWS_ACCESS_KEY_ID": env.AWS_ACCESS_KEY_ID,
  "AWS_SECRET_ACCESS_KEY": env.AWS_SECRET_ACCESS_KEY,
  "FTP_CONNECTION_STRING": env.FTP_CONNECTION_STRING,
  "AZURE_STORAGE_STRING": env.AZURE_STORAGE_STRING,
  "IsTest": env.NODE_ENV === 'development',
  "Bucket": 'brick-ftp',
  "QueueUrl": "https://sqs.us-west-2.amazonaws.com/697537225083/BrickFtpBackupQueue",
  "IdleTime": 60
};
