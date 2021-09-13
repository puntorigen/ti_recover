![ti_recover](https://user-images.githubusercontent.com/57605485/133170750-20244127-1ea0-4cd0-9c67-ac5ca44f17bc.png)

Package and command-line (CLI) that helps you recover your lost source code from almost any APK made using Appcelerator Titanium, either be in development or distribution mode. 

## INSTALL
```bash
npm install -g puntorigen/ti_recover
```

## USAGE
It comes with a command-line (CLI), that uses all methods of this package, and that you can use as follows:  

```bash
ti_recover apkfile.apk outputdir
```

As part of my blog post: <a href="https://pabloschaffner.cl/2017/02/01/how-recoverable-is-an-apk-source-code-made-with-titanium/">link to my blog</a><br/>
As a package contains the following methods:

### init (config, onReadyCB).  
Initializes the component.<br/>
Can have the keys:<br/>
**apk** (apkfile to open),<br/>
**apk_dir** (optional apk_unpack dir already create to re-utilize it),<br/>
**out_dir** (outputdir)<br/><br/>

### test (onReadyCB).  
This returns true/false on the callback, indicating the given APK was made or not using Titanium.  

### extract (onReadyCB).  
This does the extraction of assets and js sources into memory.  

### reconstruct (onReadyCB).  `in progress`
This attempts to rebuild the source code from memory into a structure that can be opened as a Titanium Project. 
Can be called before writeToDisk to have a well formed Titanium project.  

### writeToDisk ().
This creates the files and directories of the source code in memory to the given outputdir. 

### copyAssets ().
This retrieves the APK image and resources assets into the outputdir.

### clean ().
This cleanses the temporal directory used to process the files.  

### info (callback(err,data)).  `in progress`
Retrieves Titanium information about the current APK using the extracted resources. Must be called after 'extract' method.  


## UPDATES

version 1.1.1:
- now assets are put on the correct directories.

version 1.0.9:
- updated to latest apk_unpack to use jadx.
- now resources and manifest are also copied to outputdir

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