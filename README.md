Appcelerator Titanium APK source code recovery tool
==============================
## INTRO

This package and command-line (CLI) helps you recover your lost source code from almost any APK made using Appcelerator Titanium, either be in development or distribution mode. It contains 4 main methods:

### init (config, onReadyCB).  
Initializes the component.<br/>
Can have the keys:<br/>
**apk** (apkfile to open),<br/>
**apk_dir** (optional apk_unpack dir already create to re-utilize it),<br/>
**out_dir** (outputdir)<br/><br/>

### test (onReadyCB).  
This returns true/false on the callback, indicating the given APK was made or not using Titanium.  

### extract (onReadyCB).  
This does the extraction of assets and js sources into memory (passed to callback onReady(err, data)).  

### reconstruct (onReadyCB).  `in progress`
This attempts to rebuild the source code from memory into a structure that can be opened as a Titanium Project. Passes the restructured code to the callback. Can be called before writeToDisk to have a well formed Titanium project.  

### writeToDisk ().
This creates the files and directories of the source code in memory to the given outputdir.  

### info (callback(err,data)).  `in progress`
Retrieves information about the given APK using the extracted resources. Must be called after 'extract' method.  

## USAGE
It comes with a command-line (CLI), that uses all methods of this package, and that you can use as follows:  

```javascript
ti_recover apkfile.apk outputdir
```

## UPDATES

version 1.0.6:
- added ability to recover APKs created in development mode.

version 1.0.5:
- improved readability of CLI, added prettyfier to source code, and bugfix several issues.

version 1.0.4:
- fixed tmp dir location bug. Now CLI works ok.

version 1.0.2-3: 
- added delay before decrypting files, to account for slower hdd disks

version 1.0.1: 
- fixed console debug

version 1.0.0: 
- first version
- Add readme.md file