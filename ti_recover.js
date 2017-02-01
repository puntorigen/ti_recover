// ti_recover.js
// TO DO: java is one instance ONLY, must init from here and then share its instance across apk_unpack and ti_unpack.

var _java 		=	require("./java_init"),
	ti 			= 	require('./ti_unpack'),		// extract(config, onReadyCB(full))	
	apk			=	require('apk_unpack'),		// extract(apkfile, outputdir, onReadyCB)
	cwd 		= 	process.cwd(),
	fs 			=	require('fs'),
	path 		=	require('path'),
	mkdirp 		= 	require('mkdirp'),
	colors 		= 	require('colors');

var _tmp 		= 	{
	package_name 	: 	'',
	memory_source 	: 	{},
	_tmp_used 		: 	false
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
			console.log('preparing -> extracting and decrypting classes.dex'.green);
			apk.decompile(function() {
				console.log('preparing -> ready'.green);
				if (_config.tmp_dir!='' && _config.tmp_dir.charAt(0)!=path.sep && _config.tmp_dir.charAt(0)!='~') {
					_config.apk_dir 	= path.join(cwd,_config.tmp_dir+path.sep);	
				} else {
					_config.apk_dir 	= _config.tmp_dir;
				}
				_tmp._tmp_used = true;
				setTimeout(function(){
					// executed delay to wait for files to be written on slower hd disks.
					onReady();
				},100);
			});
		});
	} else if (_config.apk_dir!='') {
		// the apk_dir was given, so skip decompiler
		onReady();
	} else {
		console.log('The given APK file doesn\'t exist.'.red);
		//onReady();
	}
};

var test = function(onReady) {
	// return true if given apk is a Titanium made APK, false otherwise.
	// get main package name from manifest
	packageInfo(function(err,data) {
		if (err==true) {
			onReady(true, false);
		} else {
			_tmp.package_name 	= 	data['package'];
			_tmp.package_dir 	= 	data['package'].split('.').join(path.sep);
			// test if AssetCryptImpl files exist in _config.apk_dir package_dir smali and src
			_tmp.smali_loc 		= 	_config.apk_dir + 'smali' + path.sep + _tmp.package_dir + path.sep + 'AssetCryptImpl.smali';
			_tmp.java_loc 		= 	_config.apk_dir + 'src' + path.sep + _tmp.package_dir + path.sep + 'AssetCryptImpl.java';
			//console.log('_tmp locations:',_tmp);
			if (fileExists(_tmp.smali_loc) && fileExists(_tmp.java_loc)) {
				onReady(false, true);
			} else {
				onReady(false, false);
			}
		}
	});
};

var extract = function(onReady) {
	test(function(err1,isit) {
		if (isit==true) {
			// its an appcelerator apk.
			ti.init({ smali:_tmp.smali_loc, java:_tmp.java_loc, debug:true },function(r) {
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

var _prettyCode = function(jscode) {
	// reformat the given code
	var beautify = require('js-beautify').js_beautify;
	return beautify(jscode, { indent_with_tabs: true });
};

var writeToDisk = function() {
	if (_config.out_dir.charAt(0)!=path.sep && _config.out_dir.charAt(0)!='~') {
		// if _config.out_dir is a relative location.
		_config.out_dir = __dirname+path.sep+_config.out_dir+path.sep;
		_config.out_dir = _config.out_dir.split(path.sep+path.sep).join(path.sep);	// ensure path sep isn't doubled.
		//console.log('writeToDisk->out_dir',_config.out_dir);
	} else {
		_config.out_dir = _config.out_dir+path.sep;
		_config.out_dir = _config.out_dir.split(path.sep+path.sep).join(path.sep);	// ensure path sep isn't doubled.
		//console.log('writeToDisk->absolute dir->out_dir',_config.out_dir);
	}
	// loop over all files in memory and write their code to the out_dir
	if (_tmp.memory_source!='') {
		var _i;
		for (_i in _tmp.memory_source) {
			var _tmp_file = _config.out_dir + _i;
			var _tmp_justdir = path.dirname(_tmp_file);
			mkdirp.sync(_tmp_justdir);
			// write source content to disk
			if (fileExists(_tmp_file)) {
				// delete existing file first
				fs.truncateSync(_tmp_file,0);
			}
			fs.writeFileSync(_tmp_file, _prettyCode(_tmp.memory_source[_i].content));
			console.log(colors.yellow('writeToDisk-> file '+_i+' written.'));
		}
	} else {
		console.log('writeToDisk-> You must first call extract method.'.red);
	}
};

var clean = function() {
	// deletes the _tmp directory
	try {
		if (_tmp._tmp_used==true) {
			deleteFolderRecursive(_config.apk_dir);
			console.log('clean->ok'.green);
		}
	} catch(a) {
	}
};

exports.init = init;
exports.test = test;
exports.extract = extract;
exports.writeToDisk = writeToDisk;
exports.clean = clean;

// ******************
// helper methods
// ******************
var packageInfo = function(callback) {
	// to be called after 'extractAPK', gets info about APK from decoded AndroidManifest.xml
	var cheerio = require('cheerio');
	var reply = {};
	var _manifest = _config.apk_dir + 'AndroidManifest.xml';
	//console.log('DEBUG:manifest loc:',_manifest);
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
};

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
};

var deleteFolderRecursive = function(path) {
  if( fs.existsSync(path) ) {
    fs.readdirSync(path).forEach(function(file,index){
      var curPath = path + "/" + file;
      if(fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
};