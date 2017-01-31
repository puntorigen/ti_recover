// ti_recover.js
var ti 			= 	require('./ti_unpack'),		// extract(config, onReadyCB(full))	
	apk			=	require('apk_unpack'),		// extract(apkfile, outputdir, onReadyCB)
	cwd 		= 	process.cwd(),
	fs 			=	require('fs'),
	path 		=	require('path');

var _tmp 		= 	{
	package_name 	: 	''
};

var _config = {
	apk 		: 	'',
	apk_dir		: 	'',
	out_dir 	: 	'',
	tmp_dir 	: 	'_tmp',
	debug 		: 	true
};

var init = function(config, onReady) {
	// config
	for (var _c in config) _config[_c] = config[_c];
	if (_config.apk!='' && _config.apk.charAt(0)!=path.sep && _config.apk.charAt(0)!='~') {
		_config.apk = path.join(cwd,_config.apk);
	}
	// decompile apk if apk_dir doesn't exist
	if (_config.apk_dir=='' && fileExists(_config.apk)) {
		// if apk_dir is empty and the given APK file exists..
		// unpack APK to _tmp subdir
		apk.init({ apk:_config.apk, dir:_config.tmp_dir, java:true });
		apk.extract(function(err) {
			console.log('preparing -> extracting and decrypting classes.dex');
			apk.decompile(function() {
				console.log('preparing -> ready');
				_config.apk_dir 	= _config.tmp_dir;
				onReady();
			});
		});
	} else {
		onReady();
	}
};

var test = function(onReady) {
	// return true if given apk is a Titanium made APK, false otherwise.
	// get main package name from manifest
	packageInfo(function(err,data) {
		if (err) throw err;
		_tmp.package_name 	= 	data['package'];
		_tmp.package_dir 	= 	data['package'].split('.').join(path.sep);
		// test if AssetCryptImpl files exist in _config.apk_dir package_dir smali and src
		
		
	});
};




// ******************
// helper methods
// ******************
var packageInfo = function(callback) {
	// to be called after 'extractAPK', gets info about APK from decoded AndroidManifest.xml
	var cheerio = require('cheerio');
	var reply = {};
	var _manifest = _config.apk_dir + 'AndroidManifest.xml';
	if (fileExists(_manifest)) {
		fs.readFile(_manifest, function(err,_data) {
			if (err) callback(true,{});
			var $ = cheerio.load(_data, { xmlMode:true });
			reply['package'] = $('manifest[package]').attr('package');
			reply['versionCode'] = $('manifest').attr('android\:versionCode');
			reply['versionName'] = $('manifest').attr('android\:versionName');
			reply['appName'] = $('manifest application').attr('android\:label');
			reply['_dir'] = _last.dir;
			callback(false, reply);
		});
	} else {
		callback(true, {})
	}
};

var fileExists = function(filePath)
{
    try
    {
        return fs.statSync(filePath).isFile();
    }
    catch (err)
    {
        return false;
    }
}

var dirExists = function(filePath)
{
    try
    {
        return fs.statSync(filePath).isDirectory();
    }
    catch (err)
    {
        return false;
    }
}