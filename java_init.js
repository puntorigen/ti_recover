// initialezes classes for required packages
var java 		=	require('java'),
	path 		=	require('path');

java.classpath.pushDir(__dirname+path.sep+'java/dex2jar/');
java.classpath.pushDir(__dirname+path.sep+'java/');

exports.java 	= 	java;