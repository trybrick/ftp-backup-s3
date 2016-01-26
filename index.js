var Consumer = require('sqs-consumer');
var AWS      = require('aws-sdk');
var config   = require('../../aws.json');
var Client   = require('ftp');
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

function handleMessage (msg, cb){
  var validActions = ['create', 'update'];

  console.log('message: ' + JSON.stringify(msg, null, 2));
  if (validActions.indexOf(msg.queryParams.action) > -1)
  {
    config.messageCount++;
    console.log('processing...');
    downloadFile(msg, cb);
    return;
  }
  console.log('ignoring...');

  cb();
}

function downloadFile(msg, callback) {
	var client = new FTP();
	client.on('ready', function() {
    console.log('getting file: ' + msg.target.ftp);

    client.get(msg.target.ftp, function(err, data) {
      if (err) {
        console.log('ftp error: ' + err);
        callback();
      	return;
      }

      var passThrough = new stream.PassThrough();
      var s3ref = data.pipe(passThrough);
      var s3params = {params: {Bucket: config.Bucket, Key: msg.target.path}};
  		var s3obj = new AWS.S3(s3params);
      var progressEvt = {total: 0};
  		s3obj.upload({Body: s3ref})
			  .on('httpUploadProgress', function(evt) {
		    	// console.log('Progress:', evt);
          progressEvt = evt;
		  	})
		  	.send(function(err, data) { 
          client.end();
			  	console.log(err ? 'error: ' + err : 'data: ', data);
          if (!err) {
            // valid to process for 7 days/1 week
            var s3obj2 = new AWS.S3(s3params);
            s3params.params.Expires = 604800;
            msg.up = data;
            msg.down = {
              url: s3obj2.getSignedUrl('getObject', s3params.params),
              size: (progressEvt || {}).total
            };
            
            if (/\.pdf+/gi.test(msg.down.url)) {
              msg.jpg = 'http://noogen.net/lib/pdftojpg.php?url=' + encodeURIComponent(msg.down.url);
            }

            var sortKey = 8640000000000000 - (new Date()).getTime();
            var rk = sortKey + '::' + msg.
              target.ftp.
              replace(/\/+/gi, '_').
              replace(/\W+/gi, '-');
            try {
              tbl.write(msg.pathParams.clientid, rk, msg);
            } catch(e) {
              console.log('azure err: ' + e);
            }
          }

			  	callback(err);
			});
		});
	});

	client.connect({
	    host: config.FtpHost,
	    user: config.FtpUser,
	    password: config.FtpPass,
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
  	handleMessage(msg, done);
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
