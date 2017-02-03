// initialezes classes for required packages
var java 		=	require('java'),
	path 		=	require('path');

java.classpath.pushDir(__dirname+path.sep+'java/jadx/');
java.classpath.pushDir(__dirname+path.sep+'java/');

exports.java 	= 	java;