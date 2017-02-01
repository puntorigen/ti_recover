// ti_recover.js
// TO DO: java is one instance ONLY, must init from here and then share its instance across apk_unpack and ti_unpack.

var _java 		=	require("./java_init"),
	ti 			= 	require('./ti_unpack'),		// extract(config, onReadyCB(full))	
	apk			=	require('apk_unpack'),		// extract(apkfile, outputdir, onReadyCB)
	cwd 		= 	process.cwd(),
	fs 			=	require('fs'),
	path 		=	require('path');

var _tmp 		= 	{
	package_name 	: 	'',
	memory_source 	: 	{}
};

var _config = {
	apk 		: 	'',
	full_apk 	: 	'',
	apk_dir		: 	'',
	out_dir 	: 	'',
	tmp_dir 	: 	'_tmp',
	debug 		: 	true
};

var init = function(config, onReady) {
	// config
	for (var _c in config) _config[_c] = config[_c];
	if (_config.apk!='' && _config.apk.charAt(0)!=path.sep && _config.apk.charAt(0)!='~') {
		_config.full_apk = path.join(cwd,_config.apk);
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
				_config.apk_dir 	= __dirname+path.sep+_config.tmp_dir+path.sep;
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
		if (err==true) {
			onReady(true, {});
		} else {
			_tmp.package_name 	= 	data['package'];
			_tmp.package_dir 	= 	data['package'].split('.').join(path.sep);
			// test if AssetCryptImpl files exist in _config.apk_dir package_dir smali and src
			_tmp.smali_loc 		= 	_config.apk_dir + 'smali' + path.sep + _tmp.package_dir + path.sep + 'AssetCryptImpl.smali';
			_tmp.java_loc 		= 	_config.apk_dir + 'src' + path.sep + _tmp.package_dir + path.sep + 'AssetCryptImpl.java';
			console.log('ti_recover->test->',_tmp);
			if (fileExists(_tmp.smali_loc) && fileExists(_tmp.java_loc)) {
				onReady(true);
			} else {
				onReady(false);
			}
		}
	});
};

var extract = function(onReady) {
	test(function(isit) {
		if (isit==true) {
			// its an appcelerator apk.
			ti.init({ smali:_tmp.smali_loc, java:_tmp.java_loc, debug:false },function(r) {
				ti.decrypt(function(err, data) {
					if (err==true) {
						onReady(true, {});
					} else {
						_tmp.memory_source = data;
						onReady(false, data);
					}
				});
			});
		} else {
			onReady(true, {});
		}
	});
};

exports.init = init;
exports.test = test;
exports.extract = extract;

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
			if (err==true) {
				callback(true,{});
			} else {
				var $ = cheerio.load(_data, { xmlMode:true });
				reply['package'] = $('manifest[package]').attr('package');
				reply['versionCode'] = $('manifest').attr('android\:versionCode');
				reply['versionName'] = $('manifest').attr('android\:versionName');
				reply['appName'] = $('manifest application').attr('android\:label');
				reply['_dir'] = _config.apk_dir;
				callback(false, reply);
			}
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