// ti_recover.js
var ti 			= 	require('./ti_unpack'),		// extract(config, onReadyCB(full))	
	apk			=	require('apk_unpack');		// extract(apkfile, outputdir, onReadyCB)

var _config = {
	apk 		: 	'',
	apk_dir		: 	'',
	out_dir 	: 	'',
	debug 		: 	true
};

var init = function(config, onReady) {
	// config
	for (var _c in config) _config[_c] = config[_c];
	onReady();
};
