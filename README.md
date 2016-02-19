# ftp-backup-s3

* process queue item from amazon sqs
* queue item has the calculated path for both the ftp file and the s3 file
* connect to ftp and download the file
* then backup the file to s3

To run:
```
npm install
```

This can just be a shell execute from jenkins Since postinstall script of npm already execute node for index.js
