/*
reads AssetCryptImpl files and return struct with Titanium file names and source codes.
*/
var 	fs 			= require('fs'),
		path 		= require('path'),
		lineReader 	= require('line-reader'),
		java 		= require('java');
		java.classpath.push(__dirname+path.sep+'java/commons-lang-2.6.jar');

var resp = {};
var meta = {
	totalBytes 	: 	0,
	ti_version 	: 	-1,
	alloy 		: 	false
};
var classes = {
	charset 	: 	java.import('java.nio.charset.Charset'),
	integer 	: 	java.import('java.lang.Integer'),
	string 		: 	java.import('java.lang.String'),
	escapeu 	: 	java.import('org.apache.commons.lang.StringEscapeUtils'),
	charbuf 	: 	java.import('java.nio.CharBuffer')
};
var _config = {
	smali 		: 	'',
	java 		: 	'',
	apk 		: 	'',
	debug 		: 	true
};

var init = function(config, onReady) {
	// config
	for (var _c in config) _config[_c] = config[_c];
	onReady();
};

var decrypt = function(onReady) {
	// read AssetCryptImpl.smali (for ranges)
	// get bytes from smali
	var bytesC = { start:false, bufferlen:0, charbuf:'', line:'', array:[] };
	var count = 0;
	if (_config.smali!='' && _config.java!='') {
		lineReader.eachLine(_config.smali, function(line, last){
			bytesC.line = line;
			if (line.indexOf('private static initAssetsBytes()Ljava/nio/CharBuffer')!=-1) {
				bytesC.start = true;
			} else if (bytesC.start && line.indexOf('const v0, ')!=-1) {
				// titanium < v5
				meta.ti_version = -5;
				bytesC.line = line.split('const v0, ').join('').trim();
				bytesC.bufferlen = classes.integer.decodeSync(bytesC.line);
				bytesC.charbuf = classes.charbuf.allocateSync(bytesC.bufferlen);
			} else if (bytesC.start && line.indexOf('const/16 v0, ')!=-1) {
				// titanium v5.x +
				meta.ti_version = 5;
				bytesC.line = line.split('const/16 v0, ').join('').trim();
				bytesC.bufferlen = classes.integer.decodeSync(bytesC.line);
				bytesC.charbuf = classes.charbuf.allocateSync(bytesC.bufferlen);
			} else if (bytesC.start && line.indexOf('const-string v1')!=-1) {
				// content
				bytesC.line = line.split('const-string v1, "').join('').trim();
				bytesC.line = bytesC.line.slice(0,-1); // remove last " char
				bytesC.line = classes.escapeu.unescapeJavaSync(bytesC.line);
				bytesC.charbuf.append(bytesC.line);
			} else if (line.indexOf('rewind()Ljava/nio/Buffer;')!=-1) {
				bytesC.charbuf.rewind();
				if (_config.debug) console.log('decoding bytes ...');
				/* */
				bytesC.assetBytes = classes.charset.forNameSync('ISO-8859-1').encodeSync(bytesC.charbuf).arraySync();
				if (_config.debug) console.log('converting into java array of bytes ... takes some time');
				var iii, _cnt=0, _inbytes = [];
				for (iii in bytesC.assetBytes) {
					_inbytes.push(java.newByte(bytesC.assetBytes[iii]));
				}
				_inbytes2 = java.newArray("byte",_inbytes);
				//read file byte ranges from AssetCryptImpl.java
				var passed_maps = false;
				if (_config.debug) console.log('extracting file ranges ...');
				meta.totalBytes = 0;
				lineReader.eachLine(_config.java, function(line2, last2) {
					var tmp = {};
					if (line2.indexOf('localHashMap.put')!=-1) {
						tmp.file = line2.split(',')[0].split('localHashMap.put(').join('').split('"').join('').trim();
						tmp.offset = line2.split(',')[1].split('new Range(').join('').trim();
						tmp.length = line2.split(',')[2].split('));').join('').trim();
						resp[tmp.file] = {
							offset 	: 	classes.integer.decodeSync(tmp.offset),
							bytes 	: 	classes.integer.decodeSync(tmp.length)
						};
						resp[tmp.file].content = _filterDataInRange(tmp.file, _inbytes2, resp[tmp.file].offset, resp[tmp.file].bytes);
						meta.totalBytes += resp[tmp.file].bytes;
						passed_maps = true;
					} else {
						if (passed_maps) {
							onReady(false, resp);
							return false;
						}
					}
				});
			}
		});
	} else {
		onReady(true,{});
	}
};

var _filterDataInRange = function(filename, ibytes, offset, length) {
	var _resp = '', _respb = '', _bytes_len=ibytes.length;
	var key = java.import('javax.crypto.spec.SecretKeySpec');
	// FIRST ATTEMPT
	try {
		// titanium below 3.2.2 and 3.4.0 decryption requires byteslen - 1
		_bytes_len = ibytes.length-1;
		var secretKeySpec = new key(	ibytes,
										_bytes_len - classes.integer.decodeSync("0x10"), 
										classes.integer.decodeSync("0x10"), 
										'AES');
		var _cipher = java.import('javax.crypto.Cipher').getInstanceSync('AES');
		var _decrypt_mode = 2; 	//cipher["DECRYPT_MODE"];
		_cipher.initSync(_decrypt_mode, secretKeySpec);
		try {
			_respb = _cipher.doFinalSync(ibytes, offset, length);
			_resp = String.fromCharCode.apply(null, new Uint16Array(_respb));
		} catch(e1a) {
			_respb = _cipher.doFinalSync(ibytes, offset-1, length);	//some files have the offset padded
			_resp = String.fromCharCode.apply(null, new Uint16Array(_respb));
		}

	} catch(e1) {
		_resp = '';	
	}
	// SECOND ATTEMPT
	if (_resp=='') {
		try {
			// titanium over v3.4.0
			_bytes_len = ibytes.length;
			var secretKeySpec = new key(	ibytes,
											_bytes_len - classes.integer.decodeSync("0x10"), 
											classes.integer.decodeSync("0x10"), 
											'AES');
			var _cipher = java.import('javax.crypto.Cipher').getInstanceSync('AES');
			var _decrypt_mode = 2; 	//cipher["DECRYPT_MODE"];
			_cipher.initSync(_decrypt_mode, secretKeySpec);
			try {
				_respb = _cipher.doFinalSync(ibytes, offset, length);
				_resp = String.fromCharCode.apply(null, new Uint16Array(_respb));
			} catch(e1a) {
				_respb = _cipher.doFinalSync(ibytes, offset-1, length);	//some files have the offset padded
				_resp = String.fromCharCode.apply(null, new Uint16Array(_respb));
			}

		} catch(e2) {
			_resp = '';
		}
	}
	if (_resp!='' && _config.debug) console.log('file:'+filename+', decrypted !');
	return _resp;
};

var extract = function(outputdir, onReady) {
	// writes the decrypted files from memory (var resp) into the given directory (creating as needed)

};

exports.init = init;
exports.decrypt = decrypt;
exports.extract = extract;

/* uncomment for testing
init({ smali:'test/AssetCryptImpl.smali', java:'test/AssetCryptImpl.java' }, function() {
	decrypt(function(err, full) {
		if (!err) console.log(full); 
	});
});*/