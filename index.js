var Consumer = require('sqs-consumer');
var AWS      = require('aws-sdk');
var config   = require('../../aws.json');
var Client   = require('ftp');
var moment   = require('moment');
var path     = require('path');
var fs       = require('fs');
var FTP      = require('ftp');
var stream   = require('stream');
var azStorageSimple = require('azure-storage-simple');
var azStorage = azStorageSimple(config.AzureAccount, config.AzureKey);
var tbl = azStorage.table('brickftplog');

AWS.config.update({
  region: config.Region,
  accessKeyId: config.AccessId,
  secretAccessKey: config.AccessKey
});

config.startTime = new Date();
config.isRunning = false;
config.messageCount = 0;

function downloadFile(myConfig, myMessage, callback) {
	var client = new FTP();
	console.log('message: ' + JSON.stringify(myMessage, null, 4));
	client.on('ready', function() {
    console.log('getting file: ' + myMessage.target.ftp);

    client.get(myMessage.target.ftp, function(err, data) {
      if (err) {
        console.log('ftp error: ' + err);
        callback();
      	return;
      }

      var passThrough = new stream.PassThrough();
      var s3ref = data.pipe(passThrough);
			var s3obj = new AWS.S3({params: 
        {Bucket: myConfig.Bucket, 
          Key: myMessage.target.path} });
			s3obj.upload({Body: s3ref})
				/*.on('httpUploadProgress', function(evt) {
			    	console.log('Progress:', evt); 
			  	}) */
			  	.send(function(err, data) { 
            client.end();
				  	console.log(err ? 'error: ' + err : 'data: ', data);
            if (!err) {
              // valid to process for 7 days/1 week
              params.Expires = 604800;
              myMessage.target.download = s3.getSignedUrl('getObject', params);
              var sortKey = 8640000000000000 - (new Date()).getTime();
              var rk = sortKey + '::' + myMessage.
                target.ftp.
                replace(/\/+/gi, '_').
                replace(/\W+/gi, '-');
              try {
                tbl.write(myMessage.pathParams.clientid, rk, myMessage);
              } catch(e) {
                console.log('azure err: ' + e);
              }
            }
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
var currentCallback = null;

var app = Consumer.create({
  queueUrl: config.QueueUrl,
  visibilityTimeout: 60,
  handleMessage: function (message, done) {
  	config.lastActionTime = new Date();
  	config.isRunning = true;
    currentCallback = done;
  	var msg = JSON.parse(message.Body);
  	var validActions = ['create', 'update'];

  	if (validActions.indexOf(msg.queryParams.action) > -1)
    {
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

process.on('uncaughtException', function(err) {
  // handle the error safely
  console.log('uncaught error: ' + err)
  if (currentCallback) {
    currentCallback();
  }
})

app.start();

// test download
// downloadFile(config, sampleMsg, function() {});
