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

### reconstruct (onReadyCB).  **in progress**
This attempts to rebuild the source code from memory into a structure that can be opened as a Titanium Project. Passes the restructured code to the callback. Can be called before writeToDisk to have a well formed Titanium project.  

### writeToDisk (onReadeyCB).  **in progress**
This creates the files and directories of the source code in memory to the given outputdir.  

### info (callback(err,data)).  
Retrieves information about the given APK using the extracted resources. Must be called after 'extract' method.  

## USAGE
It comes with a command-line (CLI), that uses all methods of this package, and that you can use as follows:  

**ti_recover** `apkfile.apk` `outputdir`

## UPDATES

version 1.0.0: 
- first version
- Add readme.md file