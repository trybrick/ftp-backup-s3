var Consumer = require('sqs-consumer');
var AWS      = require('aws-sdk');
var config   = require('../aws.json');
var Client   = require('ftp');
var moment   = require('moment');
var path     = require('path');
var fs       = require('fs');
var FTP      = require('ftp');
var stream   = require('stream');

AWS.config.update({
  region: config.Region,
  accessKeyId: config.AccessId,
  secretAccessKey: config.AccessKey
});

config.startTime = new Date();
config.isRunning = false;
config.messageCount = 0;

var isClientId = /\d+/gi;

/* Message Example */
var msg = {
  "queryParams": {
    "action": "create",
    "at": "2016-01-06T11:08:20 00:00",
    "destination": "FTPRoot/Roundys/Marianos/data/MARIANOS_20151108_HIF.ZIP",
    "interface": "ftp",
    "path": "FTPRoot/Roundys/Marianos/data/MARIANOS_20151108_HIF.ZIP",
    "type": "file",
    "username": "blahblah"
  },
  "pathParams": {
    "clientid": "218"
  }
}


function downloadFile(myConfig, myMessage, callback) {
	var client = new FTP();
	var fileName = myMessage.queryParams.path.replace('FTPRoot/', '');
	console.log('message: ' + JSON.stringify(myMessage, null, 4));
	client.on('ready', function() {

    var s3FileName = fileName;
    var rootIdx = fileName.indexOf('/');
    if (rootIdx > 0) {
      s3FileName = fileName.substring(rootIdx + 1);
    }

		var dirName = path.dirname(fileName);
		console.log('downloading: ' + s3FileName);
    client.get(fileName, function(err, data) {
      if (err) {
      	callback(err);
      	throw err;
      }

  	  // data.once('close', function() { client.end(); });

			var today = moment(Date.parse(myMessage.queryParams.at.substring(0,10)));
      var folderPrefix = 'archive/';

      if (!isClientId.test(myMessage.pathParams.clientid + '')) {
        folderPrefix = myMessage.pathParams.clientid + '/';
      }

      var passThrough = new stream.PassThrough();
      var s3ref = data.pipe(passThrough);
      var s3Key = folderPrefix + today.format('YYYYMMDD/');
      s3Key += myMessage.pathParams.clientid + '/' + s3FileName;

			console.log('uploading: ' + s3Key);
			var s3obj = new AWS.S3({params: {Bucket: myConfig.Bucket, Key: s3Key} });
			s3obj.upload({Body: s3ref})
				/*.on('httpUploadProgress', function(evt) {
			    	console.log('Progress:', evt); 
			  	}) */
			  	.send(function(err, data) { 
				  	console.log(err ? 'error: ' + err : 'data: ', data);
            client.end();
				  	callback(err);
				});
		});
	});

	client.connect({
	    host: myConfig.FtpHost,
	    user: myConfig.FtpUser,
	    password: myConfig.FtpPass,
	    secure: true
	});
}

var app = Consumer.create({
  queueUrl: config.QueueUrl,
  visibilityTimeout: 60,
  handleMessage: function (message, done) {
  	config.lastActionTime = new Date();
  	config.isRunning = true;
  	var msg = JSON.parse(message.Body);
  	var validActions = ['create', 'update', 'move','copy'];

  	if (validActions.indexOf(msg.queryParams.action) > -1) {
      config.messageCount++;
  		console.log(message);
  		downloadFile(config, msg, done);
  		return;
  	}

    done();
  }
});
 
app.on('error', function (err) {
  console.log('queue err: ' + err);
  config.isRunning = false;
});

app.on('message_processed', function(message){
  config.isRunning = false;
});
 
var idleLimit = (config.IdleTime||15)*1000;

function handleIdle() {
	var currentTime = new Date();
    var diffMs = (currentTime - (config.lastActionTime || config.startTime));
    console.log(diffMs);

	if (!config.isRunning && diffMs > idleLimit)
	{
		console.log('idle timeout...' )
		app.stop();
		process.exit(config.messageCount > 0 ? 0 : 1);
		return;
	}
	
	setTimeout(handleIdle, 999);
	return;
}

// idling timeout
setTimeout(handleIdle, 999);
app.start();


//downloadFile(config, msg, function() {});
